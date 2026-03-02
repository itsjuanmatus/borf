use super::cache::{DecodedTrackCache, DecodedTrackSource};
use super::decode::{
    decode_track_with_symphonia, try_append_streaming_source, try_append_symphonia_streaming_source,
};
use super::events::{AudioPositionEvent, AudioStateEvent};
use crate::db::SongPlaybackInfo;
use rodio::Sink;
use serde::Deserialize;
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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackTransition {
    Immediate,
    Crossfade,
}

impl PlaybackTransition {
    fn as_str(self) -> &'static str {
        match self {
            PlaybackTransition::Immediate => "immediate",
            PlaybackTransition::Crossfade => "crossfade",
        }
    }
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

pub(super) struct CrossfadeContext {
    outgoing_sink: Sink,
    outgoing_song_id: String,
    fade_duration_ms: u64,
    started_at: Option<Instant>,
    elapsed_before_pause_ms: u64,
    incoming_level: f32,
    outgoing_level: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AppliedTransitionMode {
    Immediate,
    Crossfade,
}

impl AppliedTransitionMode {
    fn as_str(self) -> &'static str {
        match self {
            AppliedTransitionMode::Immediate => "immediate",
            AppliedTransitionMode::Crossfade => "crossfade",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TransitionResolution {
    pub(super) mode: AppliedTransitionMode,
    pub(super) requested_fade_ms: Option<u64>,
    pub(super) effective_fade_ms: Option<u64>,
    pub(super) fallback_reason: Option<&'static str>,
}

impl TransitionResolution {
    fn immediate(requested_fade_ms: Option<u64>, fallback_reason: Option<&'static str>) -> Self {
        Self {
            mode: AppliedTransitionMode::Immediate,
            requested_fade_ms,
            effective_fade_ms: None,
            fallback_reason,
        }
    }

    fn crossfade(requested_fade_ms: u64, effective_fade_ms: u64) -> Self {
        Self {
            mode: AppliedTransitionMode::Crossfade,
            requested_fade_ms: Some(requested_fade_ms),
            effective_fade_ms: Some(effective_fade_ms),
            fallback_reason: None,
        }
    }
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
    crossfade: &mut Option<CrossfadeContext>,
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    song: SongPlaybackInfo,
    start_ms: Option<u64>,
    transition: Option<PlaybackTransition>,
    crossfade_ms: Option<u64>,
) -> Result<(), String> {
    let started_at = Instant::now();
    let song_id = song.id.clone();
    let duration_ms = resolve_duration_ms(&song);
    let desired_start_ms = start_ms.unwrap_or_else(|| song.custom_start_ms.max(0) as u64);
    let bounded_start_ms = bound_to_duration(desired_start_ms, duration_ms);
    let requested_transition = transition.unwrap_or(PlaybackTransition::Immediate);
    log::debug!(
        "audio play transition request: song_id={} mode={} requested_fade_ms={:?}",
        song_id,
        requested_transition.as_str(),
        crossfade_ms
    );
    let mut transition_resolution = resolve_transition_request(
        requested_transition,
        crossfade_ms,
        playback.as_ref(),
        duration_ms,
    );
    log::debug!(
        "audio play transition resolved: song_id={} mode={} effective_fade_ms={:?} fallback_reason={}",
        song_id,
        transition_resolution.mode.as_str(),
        transition_resolution.effective_fade_ms,
        transition_resolution.fallback_reason.unwrap_or("none")
    );

    stop_active_crossfade(crossfade, "new-play-request");
    if transition_resolution.mode == AppliedTransitionMode::Immediate {
        stop_current_playback(playback);
    }

    let initial_volume = if transition_resolution.mode == AppliedTransitionMode::Crossfade {
        0.0
    } else {
        volume
    };

    let (sink, sink_mode) = create_streaming_sink(
        stream_handle,
        &song.file_path,
        decoded_track_cache,
        streaming_failures,
        initial_volume,
        bounded_start_ms,
        PlaybackStatus::Playing,
    )?;
    log::debug!(
        "audio play sink mode: song_id={} mode={} start_ms={}",
        song_id,
        sink_mode.as_str(),
        bounded_start_ms
    );

    let mut outgoing_for_crossfade: Option<PlaybackContext> = None;
    if transition_resolution.mode == AppliedTransitionMode::Crossfade {
        outgoing_for_crossfade = playback.take();
    }

    let sink = sink;
    if transition_resolution.mode == AppliedTransitionMode::Crossfade
        && outgoing_for_crossfade.is_none()
    {
        transition_resolution = TransitionResolution::immediate(
            transition_resolution.requested_fade_ms,
            Some("no-active-track-after-resolution"),
        );
        sink.set_volume(volume);
        log::debug!(
            "audio play transition fallback: song_id={} reason=no-active-track-after-resolution",
            song_id
        );
    }

    *playback = Some(PlaybackContext {
        sink,
        song_id: song.id,
        file_path: song.file_path,
        duration_ms,
        base_position_ms: bounded_start_ms,
        started_at: Some(Instant::now()),
        status: PlaybackStatus::Playing,
    });

    if transition_resolution.mode == AppliedTransitionMode::Crossfade {
        if let Some(outgoing) = outgoing_for_crossfade {
            let fade_duration_ms = transition_resolution.effective_fade_ms.unwrap_or(0);
            let outgoing_song_id = outgoing.song_id;
            let outgoing_sink = outgoing.sink;
            *crossfade = Some(CrossfadeContext {
                outgoing_sink,
                outgoing_song_id: outgoing_song_id.clone(),
                fade_duration_ms,
                started_at: Some(Instant::now()),
                elapsed_before_pause_ms: 0,
                incoming_level: 0.0,
                outgoing_level: 1.0,
            });
            if let (Some(current), Some(active_crossfade)) = (playback.as_ref(), crossfade.as_mut())
            {
                apply_crossfade_levels(active_crossfade, current, volume);
            }
            log::debug!(
                "audio crossfade started: from_song_id={} to_song_id={} fade_ms={}",
                outgoing_song_id,
                song_id,
                fade_duration_ms
            );
        }
    } else if let Some(current) = playback.as_ref() {
        current.sink.set_volume(volume);
    }

    emit_state(app_handle, "playing");
    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    log::debug!(
        "audio handle_play completed: song_id={} elapsed_ms={:.1} transition_mode={} fade_ms={:?}",
        song_id,
        elapsed_ms,
        transition_resolution.mode.as_str(),
        transition_resolution.effective_fade_ms
    );
    if elapsed_ms > PLAYBACK_STARTUP_WARN_THRESHOLD_MS {
        log::warn!(
            "audio startup above SLA: threshold_ms={} song_id={} elapsed_ms={:.1} mode={} transition_mode={} fade_ms={:?}",
            PLAYBACK_STARTUP_WARN_THRESHOLD_MS,
            song_id,
            elapsed_ms,
            sink_mode.as_str(),
            transition_resolution.mode.as_str(),
            transition_resolution.effective_fade_ms
        );
    }
    Ok(())
}

pub(super) fn handle_pause(
    app_handle: &AppHandle,
    playback: &mut Option<PlaybackContext>,
    crossfade: &mut Option<CrossfadeContext>,
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
    if let Some(active_crossfade) = crossfade.as_mut() {
        active_crossfade.outgoing_sink.pause();
        active_crossfade.elapsed_before_pause_ms = crossfade_elapsed_ms(active_crossfade);
        active_crossfade.started_at = None;
    }

    emit_state(app_handle, "paused");
    Ok(())
}

pub(super) fn handle_resume(
    app_handle: &AppHandle,
    playback: &mut Option<PlaybackContext>,
    crossfade: &mut Option<CrossfadeContext>,
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
    if let Some(active_crossfade) = crossfade.as_mut() {
        active_crossfade.outgoing_sink.play();
        if active_crossfade.started_at.is_none() {
            active_crossfade.started_at = Some(Instant::now());
        }
    }

    emit_state(app_handle, "playing");
    Ok(())
}

pub(super) fn handle_seek(
    app_handle: &AppHandle,
    stream_handle: &rodio::OutputStreamHandle,
    playback: &mut Option<PlaybackContext>,
    crossfade: &mut Option<CrossfadeContext>,
    decoded_track_cache: &mut DecodedTrackCache,
    streaming_failures: &mut HashSet<String>,
    volume: f32,
    position_ms: u64,
) -> Result<(), String> {
    let Some(current) = playback.as_mut() else {
        return Ok(());
    };
    stop_active_crossfade(crossfade, "seek");

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
    current.sink.set_volume(volume);

    let _ = app_handle.emit(
        "audio:position-update",
        AudioPositionEvent {
            current_ms: bounded_position,
            duration_ms: current.duration_ms,
        },
    );

    Ok(())
}

pub(super) fn apply_master_volume(
    playback: &mut Option<PlaybackContext>,
    crossfade: &mut Option<CrossfadeContext>,
    volume: f32,
) {
    let Some(current) = playback.as_ref() else {
        return;
    };

    if let Some(active_crossfade) = crossfade.as_mut() {
        apply_crossfade_levels(active_crossfade, current, volume);
        return;
    }

    current.sink.set_volume(volume);
}

pub(super) fn poll_crossfade(
    playback: &mut Option<PlaybackContext>,
    crossfade: &mut Option<CrossfadeContext>,
    volume: f32,
) {
    let Some(current) = playback.as_ref() else {
        stop_active_crossfade(crossfade, "no-active-playback");
        return;
    };

    let Some(mut active_crossfade) = crossfade.take() else {
        return;
    };

    if current.status != PlaybackStatus::Playing {
        *crossfade = Some(active_crossfade);
        return;
    }

    if active_crossfade.outgoing_sink.empty() {
        log::debug!(
            "audio crossfade completed early: outgoing_song_id={} reason=outgoing-empty",
            active_crossfade.outgoing_song_id
        );
        active_crossfade.outgoing_sink.stop();
        current.sink.set_volume(volume);
        return;
    }

    let elapsed_ms = crossfade_elapsed_ms(&active_crossfade);
    let (outgoing_level, incoming_level) =
        crossfade_ramp_levels(elapsed_ms, active_crossfade.fade_duration_ms);
    active_crossfade.outgoing_level = outgoing_level;
    active_crossfade.incoming_level = incoming_level;
    apply_crossfade_levels(&active_crossfade, current, volume);

    if elapsed_ms >= active_crossfade.fade_duration_ms || incoming_level >= 1.0 {
        log::debug!(
            "audio crossfade completed: outgoing_song_id={} fade_ms={} elapsed_ms={}",
            active_crossfade.outgoing_song_id,
            active_crossfade.fade_duration_ms,
            elapsed_ms
        );
        active_crossfade.outgoing_sink.stop();
        current.sink.set_volume(volume);
        return;
    }

    *crossfade = Some(active_crossfade);
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

fn stop_current_playback(playback: &mut Option<PlaybackContext>) {
    if let Some(existing) = playback.take() {
        existing.sink.stop();
    }
}

fn stop_active_crossfade(crossfade: &mut Option<CrossfadeContext>, reason: &str) {
    if let Some(active_crossfade) = crossfade.take() {
        log::debug!(
            "audio crossfade cleared: outgoing_song_id={} reason={}",
            active_crossfade.outgoing_song_id,
            reason
        );
        active_crossfade.outgoing_sink.stop();
    }
}

fn apply_crossfade_levels(crossfade: &CrossfadeContext, current: &PlaybackContext, volume: f32) {
    let incoming_volume = (volume * crossfade.incoming_level).clamp(0.0, 1.0);
    let outgoing_volume = (volume * crossfade.outgoing_level).clamp(0.0, 1.0);
    current.sink.set_volume(incoming_volume);
    crossfade.outgoing_sink.set_volume(outgoing_volume);
}

fn crossfade_elapsed_ms(crossfade: &CrossfadeContext) -> u64 {
    match crossfade.started_at {
        Some(started_at) => crossfade
            .elapsed_before_pause_ms
            .saturating_add(started_at.elapsed().as_millis() as u64),
        None => crossfade.elapsed_before_pause_ms,
    }
}

pub(super) fn compute_effective_crossfade_ms(
    requested_fade_ms: u64,
    current_duration_ms: u64,
    next_duration_ms: u64,
) -> u64 {
    requested_fade_ms
        .min(current_duration_ms / 2)
        .min(next_duration_ms / 2)
}

pub(super) fn crossfade_ramp_levels(elapsed_ms: u64, fade_duration_ms: u64) -> (f32, f32) {
    if fade_duration_ms == 0 {
        return (0.0, 1.0);
    }

    let progress = (elapsed_ms as f64 / fade_duration_ms as f64).clamp(0.0, 1.0) as f32;
    (1.0 - progress, progress)
}

pub(super) fn resolve_transition_request(
    transition: PlaybackTransition,
    requested_fade_ms: Option<u64>,
    active_playback: Option<&PlaybackContext>,
    next_duration_ms: u64,
) -> TransitionResolution {
    if transition != PlaybackTransition::Crossfade {
        return TransitionResolution::immediate(requested_fade_ms, None);
    }

    let Some(requested_fade_ms) = requested_fade_ms else {
        return TransitionResolution::immediate(None, Some("missing-crossfade-ms"));
    };

    if requested_fade_ms == 0 {
        return TransitionResolution::immediate(
            Some(requested_fade_ms),
            Some("invalid-crossfade-ms"),
        );
    }

    let Some(active_playback) = active_playback else {
        return TransitionResolution::immediate(Some(requested_fade_ms), Some("no-active-track"));
    };

    if active_playback.status != PlaybackStatus::Playing {
        return TransitionResolution::immediate(
            Some(requested_fade_ms),
            Some("active-track-not-playing"),
        );
    }

    if active_playback.sink.empty() {
        return TransitionResolution::immediate(
            Some(requested_fade_ms),
            Some("active-track-empty"),
        );
    }

    let effective_fade_ms = compute_effective_crossfade_ms(
        requested_fade_ms,
        active_playback.duration_ms,
        next_duration_ms,
    );
    if effective_fade_ms == 0 {
        return TransitionResolution::immediate(
            Some(requested_fade_ms),
            Some("effective-fade-zero"),
        );
    }

    TransitionResolution::crossfade(requested_fade_ms, effective_fade_ms)
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
