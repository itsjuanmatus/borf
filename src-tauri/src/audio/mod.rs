use crate::db::SongPlaybackInfo;
use rodio::{Decoder, OutputStream, Sink, Source};
use serde::Serialize;
use std::any::Any;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::BufReader;
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
    file_path: String,
    duration_ms: u64,
    base_position_ms: u64,
    started_at: Option<Instant>,
    status: PlaybackStatus,
}

const DEFAULT_DECODED_TRACK_CACHE_BYTES: usize = 384 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SinkCreationMode {
    Streaming,
    DecodedCacheHit,
    DecodedCacheMiss,
}

impl SinkCreationMode {
    fn as_str(self) -> &'static str {
        match self {
            SinkCreationMode::Streaming => "streaming",
            SinkCreationMode::DecodedCacheHit => "decoded-cache-hit",
            SinkCreationMode::DecodedCacheMiss => "decoded-cache-miss",
        }
    }
}

#[derive(Clone)]
struct DecodedTrack {
    samples: Arc<[f32]>,
    channels: u16,
    sample_rate: u32,
    duration_ms: u64,
}

impl DecodedTrack {
    fn size_bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

struct CachedDecodedTrack {
    track: DecodedTrack,
    size_bytes: usize,
}

struct DecodedTrackCache {
    max_bytes: usize,
    total_bytes: usize,
    order: VecDeque<String>,
    entries: HashMap<String, CachedDecodedTrack>,
}

struct DecodedTrackSource {
    samples: Arc<[f32]>,
    position: usize,
    channels: u16,
    sample_rate: u32,
    total_duration: Duration,
}

impl DecodedTrackSource {
    fn new(track: DecodedTrack, start_ms: u64) -> Self {
        let channels = track.channels.max(1);
        let sample_rate = track.sample_rate.max(1);
        let total_samples = track.samples.len();
        let channels_usize = channels as usize;

        let start_frame = (start_ms.saturating_mul(sample_rate as u64) / 1000) as usize;
        let mut start_index = start_frame.saturating_mul(channels_usize);
        if start_index > total_samples {
            start_index = total_samples;
        } else {
            start_index -= start_index % channels_usize;
        }

        let remaining_samples = total_samples.saturating_sub(start_index);
        let remaining_frames = remaining_samples / channels_usize;
        let remaining_duration_ms =
            ((remaining_frames as f64 * 1000.0) / sample_rate as f64).round() as u64;

        Self {
            samples: track.samples,
            position: start_index,
            channels,
            sample_rate,
            total_duration: Duration::from_millis(remaining_duration_ms),
        }
    }
}

impl Iterator for DecodedTrackSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.samples.get(self.position).copied()?;
        self.position += 1;
        Some(sample)
    }
}

impl Source for DecodedTrackSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.samples.len().saturating_sub(self.position))
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(self.total_duration)
    }
}

impl DecodedTrackCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            total_bytes: 0,
            order: VecDeque::new(),
            entries: HashMap::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<DecodedTrack> {
        let track = self.entries.get(key).map(|entry| entry.track.clone())?;
        self.touch(key);
        Some(track)
    }

    fn insert(&mut self, key: String, track: DecodedTrack) {
        let size_bytes = track.size_bytes();

        if size_bytes == 0 || size_bytes > self.max_bytes {
            return;
        }

        if let Some(previous) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(previous.size_bytes);
        }
        self.order.retain(|existing| existing != &key);

        while self.total_bytes + size_bytes > self.max_bytes {
            let Some(oldest_key) = self.order.pop_front() else {
                break;
            };
            if let Some(oldest) = self.entries.remove(&oldest_key) {
                self.total_bytes = self.total_bytes.saturating_sub(oldest.size_bytes);
            }
        }

        self.order.push_back(key.clone());
        self.total_bytes += size_bytes;
        self.entries.insert(key, CachedDecodedTrack { track, size_bytes });
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|existing| existing != key);
        self.order.push_back(key.to_string());
    }

    #[cfg(test)]
    fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    #[cfg(test)]
    fn total_bytes(&self) -> usize {
        self.total_bytes
    }
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
    ClearDecodedCache {
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

    pub fn clear_decoded_cache(&self) -> Result<(), String> {
        self.send_command_with_retry(
            |response| AudioCommand::ClearDecodedCache { response },
            "clear-decoded-cache",
        )
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
    let mut decoded_track_cache = DecodedTrackCache::new(DEFAULT_DECODED_TRACK_CACHE_BYTES);
    let mut streaming_failures = HashSet::<String>::new();

    let _ = ready_tx.send(Ok(()));

    loop {
        match command_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(AudioCommand::Play {
                song,
                start_ms,
                response,
            }) => {
                let command_started_at = Instant::now();
                let song_id = song.id.clone();
                log::debug!(
                    "audio play command received: song_id={} start_ms={:?}",
                    song_id,
                    start_ms
                );
                let result = run_command_safely("play", || {
                    handle_play(
                        &app_handle,
                        &stream_handle,
                        &mut playback,
                        &mut decoded_track_cache,
                        &mut streaming_failures,
                        volume,
                        song,
                        start_ms,
                    )
                });
                log::debug!(
                    "audio play command completed: song_id={} elapsed_ms={:.1}",
                    song_id,
                    command_started_at.elapsed().as_secs_f64() * 1000.0
                );
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
                    handle_seek(
                        &app_handle,
                        &stream_handle,
                        &mut playback,
                        &mut decoded_track_cache,
                        &mut streaming_failures,
                        volume,
                        position_ms,
                    )
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
            Ok(AudioCommand::ClearDecodedCache { response }) => {
                let result = run_command_safely("clear-decoded-cache", || {
                    decoded_track_cache = DecodedTrackCache::new(DEFAULT_DECODED_TRACK_CACHE_BYTES);
                    streaming_failures.clear();
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
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    song: SongPlaybackInfo,
    start_ms: Option<u64>,
) -> Result<(), String> {
    let started_at = Instant::now();
    let song_id = song.id.clone();
    let duration_ms = resolve_duration_ms(&song);
    let desired_start_ms = start_ms.unwrap_or_else(|| song.custom_start_ms.max(0) as u64);
    let bounded_start_ms = desired_start_ms.min(duration_ms);

    if let Some(existing) = playback.take() {
        existing.sink.stop();
    }

    let (sink, sink_mode) = create_streaming_sink(
        stream_handle,
        &song.file_path,
        decoded_track_cache,
        streaming_failures,
        volume,
        bounded_start_ms,
        PlaybackStatus::Playing,
    )?;
    log::debug!(
        "audio play sink mode: song_id={} mode={} start_ms={}",
        song_id,
        sink_mode.as_str(),
        bounded_start_ms
    );

    *playback = Some(PlaybackContext {
        sink,
        song_id: song.id,
        file_path: song.file_path,
        duration_ms,
        base_position_ms: bounded_start_ms,
        started_at: Some(Instant::now()),
        status: PlaybackStatus::Playing,
    });

    emit_state(app_handle, "playing");
    log::debug!(
        "audio handle_play completed: song_id={} elapsed_ms={:.1}",
        song_id,
        started_at.elapsed().as_secs_f64() * 1000.0
    );
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
    stream_handle: &rodio::OutputStreamHandle,
    playback: &mut Option<PlaybackContext>,
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    position_ms: u64,
) -> Result<(), String> {
    let Some(current) = playback.as_mut() else {
        return Ok(());
    };

    let bounded_position = position_ms.min(current.duration_ms);
    let seek_result = current
        .sink
        .try_seek(Duration::from_millis(bounded_position));

    if seek_result.is_err() {
        recreate_sink_from_offset(
            stream_handle,
            current,
            decoded_track_cache,
            streaming_failures,
            volume,
            bounded_position,
        )?;
    } else {
        current.base_position_ms = bounded_position;
        current.started_at = if current.status == PlaybackStatus::Playing {
            Some(Instant::now())
        } else {
            None
        };
    }

    let _ = app_handle.emit(
        "audio:position-update",
        AudioPositionEvent {
            current_ms: bounded_position,
            duration_ms: current.duration_ms,
        },
    );

    Ok(())
}

fn recreate_sink_from_offset(
    stream_handle: &rodio::OutputStreamHandle,
    current: &mut PlaybackContext,
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    offset_ms: u64,
) -> Result<(), String> {
    let (replacement_sink, sink_mode) = create_streaming_sink(
        stream_handle,
        &current.file_path,
        decoded_track_cache,
        streaming_failures,
        volume,
        offset_ms,
        current.status,
    )?;
    log::debug!(
        "audio seek recreated sink: song_id={} mode={} offset_ms={}",
        current.song_id,
        sink_mode.as_str(),
        offset_ms
    );

    current.sink.stop();
    current.sink = replacement_sink;
    current.base_position_ms = offset_ms;
    current.started_at = if current.status == PlaybackStatus::Playing {
        Some(Instant::now())
    } else {
        None
    };

    Ok(())
}

fn create_streaming_sink(
    stream_handle: &rodio::OutputStreamHandle,
    file_path: &str,
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    start_ms: u64,
    status: PlaybackStatus,
) -> Result<(Sink, SinkCreationMode), String> {
    let sink =
        Sink::try_new(stream_handle).map_err(|error| format!("failed to create sink: {error}"))?;
    sink.set_volume(volume);

    if !streaming_failures.contains(file_path) {
        match try_append_streaming_source(&sink, file_path, start_ms) {
            Ok(()) => {
                if status == PlaybackStatus::Paused {
                    sink.pause();
                } else {
                    sink.play();
                }
                return Ok((sink, SinkCreationMode::Streaming));
            }
            Err(error) => {
                streaming_failures.insert(file_path.to_string());
                log::warn!(
                    "streaming decoder failed for {}; falling back to full decode: {}",
                    file_path,
                    error
                );
            }
        }
    } else {
        log::debug!(
            "skipping streaming decoder for {} due to memoized failure",
            file_path
        );
    }

    let (decoded_track, sink_mode) = if let Some(cached_track) = decoded_track_cache.get(file_path) {
        (cached_track, SinkCreationMode::DecodedCacheHit)
    } else {
        let decoded = decode_track_with_symphonia(file_path)?;
        decoded_track_cache.insert(file_path.to_string(), decoded.clone());
        (decoded, SinkCreationMode::DecodedCacheMiss)
    };

    if decoded_track.samples.is_empty() {
        return Err(String::from("decoded audio contained no samples"));
    }

    sink.append(DecodedTrackSource::new(decoded_track, start_ms));

    if status == PlaybackStatus::Paused {
        sink.pause();
    } else {
        sink.play();
    }

    Ok((sink, sink_mode))
}

fn resolve_duration_ms(song: &SongPlaybackInfo) -> u64 {
    if song.duration_ms > 0 {
        return song.duration_ms as u64;
    }

    decode_track_with_symphonia(&song.file_path)
        .map(|decoded| decoded.duration_ms)
        .unwrap_or(0)
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

fn try_append_streaming_source(sink: &Sink, file_path: &str, start_ms: u64) -> Result<(), String> {
    let file = File::open(file_path)
        .map_err(|error| format!("failed to open audio file for playback: {error}"))?;

    let decoder = panic::catch_unwind(AssertUnwindSafe(|| Decoder::new(BufReader::new(file))))
        .map_err(|payload| {
            format!(
                "streaming decoder panic during initialization: {}",
                panic_payload_to_string(payload)
            )
        })?
        .map_err(|error| format!("failed to initialize streaming decoder: {error}"))?;

    if start_ms > 0 {
        sink.append(decoder.skip_duration(Duration::from_millis(start_ms)));
    } else {
        sink.append(decoder);
    }

    Ok(())
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
        samples: Arc::from(samples),
        channels,
        sample_rate,
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::{DecodedTrack, DecodedTrackCache, DecodedTrackSource};
    use rodio::Source;
    use std::collections::HashSet;
    use std::sync::Arc;
    use std::time::Duration;

    fn fake_track(sample_count: usize) -> DecodedTrack {
        DecodedTrack {
            samples: Arc::from(vec![0.0_f32; sample_count]),
            channels: 2,
            sample_rate: 44_100,
            duration_ms: 1_000,
        }
    }

    fn fake_track_with_samples(samples: Vec<f32>, channels: u16, sample_rate: u32) -> DecodedTrack {
        let frame_count = samples.len() as f64 / channels as f64;
        let duration_ms = (frame_count * 1000.0 / sample_rate as f64).round() as u64;
        DecodedTrack {
            samples: Arc::from(samples),
            channels,
            sample_rate,
            duration_ms,
        }
    }

    #[test]
    fn decoded_track_cache_evicts_least_recently_used_entry() {
        let mut cache = DecodedTrackCache::new(16);

        cache.insert(String::from("a"), fake_track(2));
        cache.insert(String::from("b"), fake_track(2));
        assert!(cache.contains("a"));
        assert!(cache.contains("b"));

        let _ = cache.get("a");
        cache.insert(String::from("c"), fake_track(2));

        assert!(cache.contains("a"));
        assert!(cache.contains("c"));
        assert!(!cache.contains("b"));
        assert_eq!(cache.total_bytes(), 16);
    }

    #[test]
    fn decoded_track_cache_skips_entries_larger_than_budget() {
        let mut cache = DecodedTrackCache::new(16);

        cache.insert(String::from("big"), fake_track(8));

        assert!(!cache.contains("big"));
        assert_eq!(cache.total_bytes(), 0);
    }

    #[test]
    fn decoded_track_source_applies_start_offset_without_copying_samples() {
        let track = fake_track_with_samples((0..12).map(|value| value as f32).collect(), 2, 2);
        let source = DecodedTrackSource::new(track, 1_000);

        assert_eq!(source.channels(), 2);
        assert_eq!(source.sample_rate(), 2);
        assert_eq!(source.total_duration(), Some(Duration::from_millis(2_000)));
        assert_eq!(
            source.collect::<Vec<_>>(),
            vec![4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0]
        );
    }

    #[test]
    fn decoded_track_source_handles_offset_beyond_track_length() {
        let track = fake_track_with_samples((0..12).map(|value| value as f32).collect(), 2, 2);
        let source = DecodedTrackSource::new(track, 10_000);

        assert_eq!(source.total_duration(), Some(Duration::from_millis(0)));
        assert!(source.collect::<Vec<_>>().is_empty());
    }

    #[test]
    fn streaming_failure_memoization_skips_failed_file_until_cache_clear() {
        let mut failures = HashSet::<String>::new();
        let file_path = String::from("/music/failing-file.m4a");

        assert!(!failures.contains(&file_path));
        failures.insert(file_path.clone());
        assert!(failures.contains(&file_path));

        failures.clear();
        assert!(!failures.contains(&file_path));
    }
}
