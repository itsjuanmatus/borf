use crate::db::SongPlaybackInfo;
use rodio::{OutputStream, Sink, buffer::SamplesBuffer};
use serde::Serialize;
use std::any::Any;
use std::fs::File;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct AudioStateEvent {
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioPositionEvent {
    pub current_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioTrackEndedEvent {
    pub song_id: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioErrorEvent {
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlaybackStatus {
    Playing,
    Paused,
}

struct PlaybackContext {
    sink: Sink,
    song_id: String,
    duration_ms: u64,
    base_position_ms: u64,
    started_at: Option<Instant>,
    status: PlaybackStatus,
}

struct DecodedTrack {
    samples: Vec<f32>,
    channels: u16,
    sample_rate: u32,
    duration_ms: u64,
}

enum AudioCommand {
    Play {
        song: SongPlaybackInfo,
        start_ms: Option<u64>,
        response: Sender<Result<(), String>>,
    },
    Pause {
        response: Sender<Result<(), String>>,
    },
    Resume {
        response: Sender<Result<(), String>>,
    },
    Seek {
        position_ms: u64,
        response: Sender<Result<(), String>>,
    },
    SetVolume {
        volume: f32,
        response: Sender<Result<(), String>>,
    },
}

#[derive(Clone)]
pub struct AudioEngine {
    app_handle: AppHandle,
    command_tx: Arc<Mutex<Sender<AudioCommand>>>,
    last_volume: Arc<Mutex<f32>>,
}

impl AudioEngine {
    pub fn new(app_handle: AppHandle, initial_volume: f32) -> Result<Self, String> {
        let clamped_volume = initial_volume.clamp(0.0, 1.0);
        let command_tx = spawn_audio_thread(app_handle.clone(), clamped_volume)?;

        Ok(Self {
            app_handle,
            command_tx: Arc::new(Mutex::new(command_tx)),
            last_volume: Arc::new(Mutex::new(clamped_volume)),
        })
    }

    pub fn play(&self, song: SongPlaybackInfo, start_ms: Option<u64>) -> Result<(), String> {
        self.send_command_with_retry(
            move |response| AudioCommand::Play {
                song: song.clone(),
                start_ms,
                response,
            },
            "play",
        )
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send_command_with_retry(|response| AudioCommand::Pause { response }, "pause")
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send_command_with_retry(|response| AudioCommand::Resume { response }, "resume")
    }

    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        self.send_command_with_retry(
            move |response| AudioCommand::Seek {
                position_ms,
                response,
            },
            "seek",
        )
    }

    pub fn set_volume(&self, volume: f32) -> Result<f32, String> {
        let clamped = volume.clamp(0.0, 1.0);

        self.send_command_with_retry(
            move |response| AudioCommand::SetVolume {
                volume: clamped,
                response,
            },
            "set-volume",
        )?;

        let mut volume_guard = self
            .last_volume
            .lock()
            .map_err(|_| String::from("failed to lock audio volume state"))?;
        *volume_guard = clamped;

        Ok(clamped)
    }

    pub fn emit_error(app_handle: &AppHandle, message: impl Into<String>) {
        let _ = app_handle.emit(
            "audio:error",
            AudioErrorEvent {
                message: message.into(),
            },
        );
    }

    fn send_command_with_retry<F>(
        &self,
        mut command_builder: F,
        command_label: &str,
    ) -> Result<(), String>
    where
        F: FnMut(Sender<Result<(), String>>) -> AudioCommand,
    {
        for attempt in 0..2 {
            let (response_tx, response_rx) = mpsc::channel();
            let sender = {
                let sender_guard = self
                    .command_tx
                    .lock()
                    .map_err(|_| String::from("failed to lock audio command sender"))?;
                sender_guard.clone()
            };

            if let Err(error) = sender.send(command_builder(response_tx)) {
                if attempt == 0 {
                    log::warn!(
                        "audio worker channel closed while sending {} command: {}; attempting restart",
                        command_label,
                        error
                    );
                    self.restart_worker()?;
                    continue;
                }

                return Err(format!("failed to send {command_label} command: {error}"));
            }

            match response_rx.recv() {
                Ok(result) => {
                    return result;
                }
                Err(error) => {
                    if attempt == 0 {
                        log::warn!(
                            "audio worker terminated while waiting for {} response: {}; attempting restart",
                            command_label,
                            error
                        );
                        self.restart_worker()?;
                        continue;
                    }

                    return Err(format!(
                        "failed to receive {command_label} command response: {error}"
                    ));
                }
            }
        }

        Err(format!(
            "audio worker unavailable after restart while running {command_label}"
        ))
    }

    fn restart_worker(&self) -> Result<(), String> {
        let last_volume = *self
            .last_volume
            .lock()
            .map_err(|_| String::from("failed to lock audio volume state"))?;

        let next_sender = spawn_audio_thread(self.app_handle.clone(), last_volume)?;

        let mut sender_guard = self
            .command_tx
            .lock()
            .map_err(|_| String::from("failed to lock audio command sender"))?;
        *sender_guard = next_sender;

        Ok(())
    }
}

fn spawn_audio_thread(
    app_handle: AppHandle,
    initial_volume: f32,
) -> Result<Sender<AudioCommand>, String> {
    let (command_tx, command_rx) = mpsc::channel::<AudioCommand>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    thread::spawn(move || {
        run_audio_thread(app_handle, command_rx, initial_volume, ready_tx);
    });

    let startup_result = ready_rx
        .recv()
        .map_err(|error| format!("audio thread failed during startup: {error}"))?;
    startup_result?;

    Ok(command_tx)
}

fn run_audio_thread(
    app_handle: AppHandle,
    command_rx: Receiver<AudioCommand>,
    initial_volume: f32,
    ready_tx: Sender<Result<(), String>>,
) {
    let (stream, stream_handle) = match OutputStream::try_default() {
        Ok(stream) => stream,
        Err(error) => {
            let _ = ready_tx.send(Err(format!("failed to create output stream: {error}")));
            return;
        }
    };

    let _output_stream = stream;
    let mut volume = initial_volume.clamp(0.0, 1.0);
    let mut playback: Option<PlaybackContext> = None;

    let _ = ready_tx.send(Ok(()));

    loop {
        match command_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(AudioCommand::Play {
                song,
                start_ms,
                response,
            }) => {
                let result = run_command_safely("play", || {
                    handle_play(
                        &app_handle,
                        &stream_handle,
                        &mut playback,
                        volume,
                        song,
                        start_ms,
                    )
                });
                if let Err(error) = &result {
                    AudioEngine::emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::Pause { response }) => {
                let result =
                    run_command_safely("pause", || handle_pause(&app_handle, &mut playback));
                if let Err(error) = &result {
                    AudioEngine::emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::Resume { response }) => {
                let result =
                    run_command_safely("resume", || handle_resume(&app_handle, &mut playback));
                if let Err(error) = &result {
                    AudioEngine::emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::Seek {
                position_ms,
                response,
            }) => {
                let result = run_command_safely("seek", || {
                    handle_seek(&app_handle, &mut playback, position_ms)
                });
                if let Err(error) = &result {
                    AudioEngine::emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::SetVolume {
                volume: next_volume,
                response,
            }) => {
                let result = run_command_safely("set-volume", || {
                    volume = next_volume.clamp(0.0, 1.0);
                    if let Some(current) = playback.as_mut() {
                        current.sink.set_volume(volume);
                    }
                    Ok(())
                });
                if let Err(error) = &result {
                    AudioEngine::emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Poll playback state below.
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }

        if let Some(current) = playback.as_mut() {
            if current.sink.empty() {
                let finished_song_id = current.song_id.clone();
                playback = None;

                let _ = app_handle.emit(
                    "audio:track-ended",
                    AudioTrackEndedEvent {
                        song_id: finished_song_id,
                        completed: true,
                    },
                );
                emit_state(&app_handle, "stopped");
                continue;
            }

            let current_ms = current_position_ms(current).min(current.duration_ms);
            let _ = app_handle.emit(
                "audio:position-update",
                AudioPositionEvent {
                    current_ms,
                    duration_ms: current.duration_ms,
                },
            );
        }
    }
}

fn handle_play(
    app_handle: &AppHandle,
    stream_handle: &rodio::OutputStreamHandle,
    playback: &mut Option<PlaybackContext>,
    volume: f32,
    song: SongPlaybackInfo,
    start_ms: Option<u64>,
) -> Result<(), String> {
    let decoded_track = decode_track_with_symphonia(&song.file_path)?;
    if decoded_track.samples.is_empty() {
        return Err(String::from("decoded audio contained no samples"));
    }

    let decoder_duration_ms = if song.duration_ms > 0 {
        song.duration_ms as u64
    } else {
        decoded_track.duration_ms
    };
    let desired_start_ms = start_ms.unwrap_or_else(|| song.custom_start_ms.max(0) as u64);

    if let Some(existing) = playback.take() {
        existing.sink.stop();
    }

    let sink = Sink::try_new(stream_handle)
        .map_err(|error| format!("failed to create playback sink: {error}"))?;
    sink.set_volume(volume);
    sink.append(SamplesBuffer::new(
        decoded_track.channels,
        decoded_track.sample_rate,
        decoded_track.samples,
    ));
    let bounded_start_ms = desired_start_ms.min(decoder_duration_ms);
    if bounded_start_ms > 0 {
        sink.try_seek(Duration::from_millis(bounded_start_ms))
            .map_err(|error| format!("failed to set initial playback position: {error}"))?;
    }
    sink.play();

    *playback = Some(PlaybackContext {
        sink,
        song_id: song.id,
        duration_ms: decoder_duration_ms,
        base_position_ms: bounded_start_ms,
        started_at: Some(Instant::now()),
        status: PlaybackStatus::Playing,
    });

    emit_state(app_handle, "playing");
    Ok(())
}

fn handle_pause(
    app_handle: &AppHandle,
    playback: &mut Option<PlaybackContext>,
) -> Result<(), String> {
    let Some(current) = playback.as_mut() else {
        return Ok(());
    };

    if current.status == PlaybackStatus::Paused {
        return Ok(());
    }

    current.sink.pause();
    current.base_position_ms = current_position_ms(current).min(current.duration_ms);
    current.started_at = None;
    current.status = PlaybackStatus::Paused;

    emit_state(app_handle, "paused");
    Ok(())
}

fn handle_resume(
    app_handle: &AppHandle,
    playback: &mut Option<PlaybackContext>,
) -> Result<(), String> {
    let Some(current) = playback.as_mut() else {
        return Ok(());
    };

    if current.status == PlaybackStatus::Playing {
        return Ok(());
    }

    current.sink.play();
    current.started_at = Some(Instant::now());
    current.status = PlaybackStatus::Playing;

    emit_state(app_handle, "playing");
    Ok(())
}

fn handle_seek(
    app_handle: &AppHandle,
    playback: &mut Option<PlaybackContext>,
    position_ms: u64,
) -> Result<(), String> {
    let Some(current) = playback.as_mut() else {
        return Ok(());
    };

    let bounded_position = position_ms.min(current.duration_ms);
    current
        .sink
        .try_seek(Duration::from_millis(bounded_position))
        .map_err(|error| format!("seek failed: {error}"))?;

    current.base_position_ms = bounded_position;
    current.started_at = if current.status == PlaybackStatus::Playing {
        Some(Instant::now())
    } else {
        None
    };

    let _ = app_handle.emit(
        "audio:position-update",
        AudioPositionEvent {
            current_ms: bounded_position,
            duration_ms: current.duration_ms,
        },
    );

    Ok(())
}

fn current_position_ms(playback: &PlaybackContext) -> u64 {
    match (playback.status, playback.started_at) {
        (PlaybackStatus::Playing, Some(started_at)) => {
            playback.base_position_ms + started_at.elapsed().as_millis() as u64
        }
        _ => playback.base_position_ms,
    }
}

fn emit_state(app_handle: &AppHandle, state: &str) {
    let _ = app_handle.emit(
        "audio:state-changed",
        AudioStateEvent {
            state: String::from(state),
        },
    );
}

fn run_command_safely<F>(label: &str, command: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match panic::catch_unwind(AssertUnwindSafe(command)) {
        Ok(result) => result,
        Err(payload) => Err(format!(
            "audio worker panic during {label}: {}",
            panic_payload_to_string(payload)
        )),
    }
}

fn panic_payload_to_string(payload: Box<dyn Any + Send + 'static>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    String::from("unknown panic payload")
}

fn decode_track_with_symphonia(file_path: &str) -> Result<DecodedTrack, String> {
    let file = File::open(file_path)
        .map_err(|error| format!("failed to open audio file for decode: {error}"))?;

    let mut hint = Hint::new();
    if let Some(extension) = Path::new(file_path)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        hint.with_extension(extension);
    }

    let source_stream = MediaSourceStream::new(Box::new(file), Default::default());
    let format_opts = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };

    let mut probed = get_probe()
        .format(
            &hint,
            source_stream,
            &format_opts,
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("failed to probe audio format: {error}"))?;

    let track = probed
        .format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| String::from("no decodable audio track found"))?;

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("failed to initialize audio decoder: {error}"))?;

    let mut channels = track
        .codec_params
        .channels
        .map(|channels| channels.count() as u16)
        .unwrap_or(2);
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut samples = Vec::<f32>::new();

    loop {
        let packet = match probed.format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("failed reading audio packets: {error}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("failed decoding audio packet: {error}")),
        };

        channels = decoded.spec().channels.count() as u16;
        sample_rate = decoded.spec().rate;

        let mut sample_buffer =
            SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buffer.copy_interleaved_ref(decoded);
        samples.extend_from_slice(sample_buffer.samples());
    }

    if channels == 0 || sample_rate == 0 {
        return Err(String::from("invalid decoded audio stream properties"));
    }

    let frame_count = samples.len() as f64 / channels as f64;
    let duration_ms = (frame_count * 1000.0 / sample_rate as f64).round() as u64;

    Ok(DecodedTrack {
        samples,
        channels,
        sample_rate,
        duration_ms,
    })
}
