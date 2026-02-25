use super::cache::{DecodedTrackCache, DecodedTrackSource};
use super::decode::{
    decode_track_with_symphonia, try_append_streaming_source, try_append_symphonia_streaming_source,
};
use super::events::{AudioPositionEvent, AudioStateEvent};
use crate::db::SongPlaybackInfo;
use rodio::Sink;
use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const PLAYBACK_STARTUP_WARN_THRESHOLD_MS: f64 = 300.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PlaybackStatus {
    Playing,
    Paused,
}

pub(super) struct PlaybackContext {
    pub(super) sink: Sink,
    pub(super) song_id: String,
    pub(super) file_path: String,
    pub(super) duration_ms: u64,
    pub(super) base_position_ms: u64,
    pub(super) started_at: Option<Instant>,
    pub(super) status: PlaybackStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SinkCreationMode {
    Streaming,
    SymphoniaStreamingFallback,
    DecodedCacheHit,
    DecodedCacheMiss,
}

impl SinkCreationMode {
    fn as_str(self) -> &'static str {
        match self {
            SinkCreationMode::Streaming => "streaming",
            SinkCreationMode::SymphoniaStreamingFallback => "symphonia-streaming-fallback",
            SinkCreationMode::DecodedCacheHit => "decoded-cache-hit",
            SinkCreationMode::DecodedCacheMiss => "decoded-cache-miss",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StreamingBackend {
    Rodio,
    Symphonia,
}

impl StreamingBackend {
    fn as_str(self) -> &'static str {
        match self {
            StreamingBackend::Rodio => "rodio",
            StreamingBackend::Symphonia => "symphonia",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct StreamingAttemptOrder {
    pub(super) primary: Option<StreamingBackend>,
    pub(super) fallback: StreamingBackend,
}

pub(super) fn handle_play(
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
    let bounded_start_ms = bound_to_duration(desired_start_ms, duration_ms);

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
    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    log::debug!(
        "audio handle_play completed: song_id={} elapsed_ms={:.1}",
        song_id,
        elapsed_ms
    );
    if elapsed_ms > PLAYBACK_STARTUP_WARN_THRESHOLD_MS {
        log::warn!(
            "audio startup above SLA: threshold_ms={} song_id={} elapsed_ms={:.1} mode={}",
            PLAYBACK_STARTUP_WARN_THRESHOLD_MS,
            song_id,
            elapsed_ms,
            sink_mode.as_str()
        );
    }
    Ok(())
}

pub(super) fn handle_pause(
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
    current.base_position_ms = bound_to_duration(current_position_ms(current), current.duration_ms);
    current.started_at = None;
    current.status = PlaybackStatus::Paused;

    emit_state(app_handle, "paused");
    Ok(())
}

pub(super) fn handle_resume(
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

pub(super) fn handle_seek(
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

    let bounded_position = bound_to_duration(position_ms, current.duration_ms);
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

    let primary_failed = streaming_failures.contains(file_path);
    let order = choose_streaming_attempt_order(file_path, primary_failed);
    log::debug!(
        "audio streaming order: file_path={} primary={} fallback={} primary_skipped={}",
        file_path,
        order
            .primary
            .map(|backend| backend.as_str())
            .unwrap_or("none"),
        order.fallback.as_str(),
        primary_failed
    );

    let preferred_primary = preferred_streaming_backend(file_path);
    let mut primary_error: Option<String> = None;

    if let Some(primary_backend) = order.primary {
        match append_streaming_backend(&sink, file_path, start_ms, primary_backend) {
            Ok(()) => {
                apply_sink_status(&sink, status);
                return Ok((sink, SinkCreationMode::Streaming));
            }
            Err(error) => {
                primary_error = Some(error.clone());
                streaming_failures.insert(file_path.to_string());
                log::warn!(
                    "audio streaming init failure: reason=primary-init-fail backend={} file_path={} error={}",
                    primary_backend.as_str(),
                    file_path,
                    error
                );
            }
        }
    } else {
        log::debug!(
            "audio streaming primary skipped due to memoized failure: file_path={}",
            file_path
        );
    }

    let fallback_error = match append_streaming_backend(&sink, file_path, start_ms, order.fallback)
    {
        Ok(()) => {
            apply_sink_status(&sink, status);
            let sink_mode = if preferred_primary == StreamingBackend::Rodio
                && order.fallback == StreamingBackend::Symphonia
            {
                SinkCreationMode::SymphoniaStreamingFallback
            } else {
                SinkCreationMode::Streaming
            };
            return Ok((sink, sink_mode));
        }
        Err(error) => {
            log::warn!(
                "audio streaming init failure: reason=fallback-init-fail backend={} file_path={} error={}",
                order.fallback.as_str(),
                file_path,
                error
            );
            error
        }
    };

    log::warn!(
        "audio streaming init failure: reason=full-decode-last-resort file_path={} primary_error={} fallback_error={}",
        file_path,
        primary_error.unwrap_or_else(|| String::from("memoized-primary-failure")),
        fallback_error
    );

    let (decoded_track, sink_mode) = if let Some(cached_track) = decoded_track_cache.get(file_path)
    {
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
    apply_sink_status(&sink, status);

    Ok((sink, sink_mode))
}

fn resolve_duration_ms(song: &SongPlaybackInfo) -> u64 {
    duration_from_song_metadata(song.duration_ms)
}

pub(super) fn duration_from_song_metadata(duration_ms: i64) -> u64 {
    duration_ms.max(0) as u64
}

pub(super) fn is_isobmff_extension(file_path: &str) -> bool {
    let Some(extension) = Path::new(file_path)
        .extension()
        .and_then(|value| value.to_str())
    else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "aac" | "m4a" | "m4b" | "m4p" | "m4r" | "mp4"
    )
}

pub(super) fn preferred_streaming_backend(file_path: &str) -> StreamingBackend {
    if is_isobmff_extension(file_path) {
        StreamingBackend::Symphonia
    } else {
        StreamingBackend::Rodio
    }
}

pub(super) fn choose_streaming_attempt_order(
    file_path: &str,
    primary_failed: bool,
) -> StreamingAttemptOrder {
    let preferred_primary = preferred_streaming_backend(file_path);
    let fallback = match preferred_primary {
        StreamingBackend::Rodio => StreamingBackend::Symphonia,
        StreamingBackend::Symphonia => StreamingBackend::Rodio,
    };

    StreamingAttemptOrder {
        primary: if primary_failed {
            None
        } else {
            Some(preferred_primary)
        },
        fallback,
    }
}

pub(super) fn bound_to_duration(position_ms: u64, duration_ms: u64) -> u64 {
    if duration_ms == 0 {
        position_ms
    } else {
        position_ms.min(duration_ms)
    }
}

fn append_streaming_backend(
    sink: &Sink,
    file_path: &str,
    start_ms: u64,
    backend: StreamingBackend,
) -> Result<(), String> {
    match backend {
        StreamingBackend::Rodio => try_append_streaming_source(sink, file_path, start_ms),
        StreamingBackend::Symphonia => {
            try_append_symphonia_streaming_source(sink, file_path, start_ms)
        }
    }
}

fn apply_sink_status(sink: &Sink, status: PlaybackStatus) {
    if status == PlaybackStatus::Paused {
        sink.pause();
    } else {
        sink.play();
    }
}

pub(super) fn current_position_ms(playback: &PlaybackContext) -> u64 {
    match (playback.status, playback.started_at) {
        (PlaybackStatus::Playing, Some(started_at)) => {
            playback.base_position_ms + started_at.elapsed().as_millis() as u64
        }
        _ => playback.base_position_ms,
    }
}

pub(super) fn emit_state(app_handle: &AppHandle, state: &str) {
    let _ = app_handle.emit(
        "audio:state-changed",
        AudioStateEvent {
            state: String::from(state),
        },
    );
}
