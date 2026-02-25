use super::cache::DecodedTrackCache;
use super::events::{AudioErrorEvent, AudioPositionEvent, AudioTrackEndedEvent};
use super::playback::{
    bound_to_duration, current_position_ms, emit_state, handle_pause, handle_play, handle_resume,
    handle_seek, PlaybackContext,
};
use crate::db::SongPlaybackInfo;
use rodio::OutputStream;
use std::any::Any;
use std::collections::HashSet;
use std::panic::{self, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEFAULT_DECODED_TRACK_CACHE_BYTES: usize = 384 * 1024 * 1024;
const PLAY_COMMAND_WARN_THRESHOLD_MS: f64 = 300.0;

pub(super) enum AudioCommand {
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

pub(super) fn spawn_audio_thread(
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
                let elapsed_ms = command_started_at.elapsed().as_secs_f64() * 1000.0;
                log::debug!(
                    "audio play command completed: song_id={} elapsed_ms={:.1}",
                    song_id,
                    elapsed_ms
                );
                if elapsed_ms > PLAY_COMMAND_WARN_THRESHOLD_MS {
                    log::warn!(
                        "audio play command exceeded threshold: threshold_ms={} song_id={} elapsed_ms={:.1}",
                        PLAY_COMMAND_WARN_THRESHOLD_MS,
                        song_id,
                        elapsed_ms
                    );
                }
                if let Err(error) = &result {
                    emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::Pause { response }) => {
                let result =
                    run_command_safely("pause", || handle_pause(&app_handle, &mut playback));
                if let Err(error) = &result {
                    emit_error(&app_handle, error.clone());
                }
                let _ = response.send(result);
            }
            Ok(AudioCommand::Resume { response }) => {
                let result =
                    run_command_safely("resume", || handle_resume(&app_handle, &mut playback));
                if let Err(error) = &result {
                    emit_error(&app_handle, error.clone());
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
                    emit_error(&app_handle, error.clone());
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
                    emit_error(&app_handle, error.clone());
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
                    emit_error(&app_handle, error.clone());
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

            let current_ms = bound_to_duration(current_position_ms(current), current.duration_ms);
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

fn emit_error(app_handle: &AppHandle, message: String) {
    let _ = app_handle.emit("audio:error", AudioErrorEvent { message });
}
