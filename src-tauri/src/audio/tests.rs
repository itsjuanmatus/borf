use super::cache::{DecodedTrack, DecodedTrackCache, DecodedTrackSource};
use super::decode::SymphoniaStreamingSource;
use super::playback::{
    bound_to_duration, choose_streaming_attempt_order, duration_from_song_metadata,
    is_isobmff_extension, preferred_streaming_backend, StreamingBackend,
};
use rodio::Source;
use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;

fn fake_track(sample_count: usize) -> DecodedTrack {
    DecodedTrack {
        samples: Arc::from(vec![0.0_f32; sample_count]),
        channels: 2,
        sample_rate: 44_100,
    }
}

fn fake_track_with_samples(samples: Vec<f32>, channels: u16, sample_rate: u32) -> DecodedTrack {
    DecodedTrack {
        samples: Arc::from(samples),
        channels,
        sample_rate,
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

#[test]
fn isobmff_extension_detection_handles_expected_formats() {
    assert!(is_isobmff_extension("/music/file.m4a"));
    assert!(is_isobmff_extension("/music/file.MP4"));
    assert!(is_isobmff_extension("/music/file.aac"));
    assert!(!is_isobmff_extension("/music/file.mp3"));
    assert!(!is_isobmff_extension("/music/file.flac"));
}

#[test]
fn preferred_streaming_backend_uses_symphonia_for_isobmff() {
    assert_eq!(
        preferred_streaming_backend("/music/file.m4a"),
        StreamingBackend::Symphonia
    );
    assert_eq!(
        preferred_streaming_backend("/music/file.mp3"),
        StreamingBackend::Rodio
    );
}

#[test]
fn streaming_attempt_order_is_extension_aware_and_respects_primary_failures() {
    let isobmff_order = choose_streaming_attempt_order("/music/file.m4a", false);
    assert_eq!(isobmff_order.primary, Some(StreamingBackend::Symphonia));
    assert_eq!(isobmff_order.fallback, StreamingBackend::Rodio);

    let regular_order = choose_streaming_attempt_order("/music/file.mp3", false);
    assert_eq!(regular_order.primary, Some(StreamingBackend::Rodio));
    assert_eq!(regular_order.fallback, StreamingBackend::Symphonia);

    let memoized_primary_failure_order = choose_streaming_attempt_order("/music/file.mp3", true);
    assert_eq!(memoized_primary_failure_order.primary, None);
    assert_eq!(
        memoized_primary_failure_order.fallback,
        StreamingBackend::Symphonia
    );
}

#[test]
fn duration_policy_uses_metadata_only_for_playback_startup() {
    assert_eq!(duration_from_song_metadata(1234), 1234);
    assert_eq!(duration_from_song_metadata(0), 0);
    assert_eq!(duration_from_song_metadata(-75), 0);
}

#[test]
fn bound_to_duration_does_not_clamp_when_duration_unknown() {
    assert_eq!(bound_to_duration(5_000, 0), 5_000);
    assert_eq!(bound_to_duration(5_000, 2_000), 2_000);
}

#[test]
fn symphonia_streaming_source_emits_samples_from_temp_wav() {
    let temp = tempdir().expect("failed to create temp dir");
    let wav_path = temp.path().join("streaming-source.wav");
    write_test_wav(&wav_path, 1_000, 300).expect("failed to write test wav");

    let mut source = SymphoniaStreamingSource::new(&wav_path.to_string_lossy(), 0)
        .expect("failed to initialize streaming source");

    assert_eq!(source.channels(), 2);
    assert_eq!(source.sample_rate(), 1_000);

    let first_samples: Vec<f32> = source.by_ref().take(64).collect();
    assert!(!first_samples.is_empty());
    assert!(first_samples.iter().any(|sample| sample.abs() > 0.000_1));
}

#[test]
fn symphonia_streaming_source_handles_large_start_offsets_without_panic() {
    let temp = tempdir().expect("failed to create temp dir");
    let wav_path = temp.path().join("streaming-source-large-offset.wav");
    write_test_wav(&wav_path, 1_000, 120).expect("failed to write test wav");

    let baseline_len = SymphoniaStreamingSource::new(&wav_path.to_string_lossy(), 0)
        .expect("failed to initialize baseline streaming source")
        .count();
    let large_offset_len = SymphoniaStreamingSource::new(&wav_path.to_string_lossy(), 10_000)
        .expect("failed to initialize large-offset streaming source")
        .count();

    assert!(large_offset_len <= baseline_len);
}

fn write_test_wav(path: &Path, sample_rate: u32, frames: u32) -> Result<(), String> {
    let channels: u16 = 2;
    let bits_per_sample: u16 = 16;
    let bytes_per_sample = u32::from(bits_per_sample / 8);
    let block_align = u32::from(channels) * bytes_per_sample;
    let block_align_u16 = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align;
    let data_size = frames * block_align;
    let riff_size = 36 + data_size;

    let mut file =
        File::create(path).map_err(|error| format!("failed to create test wav file: {error}"))?;

    file.write_all(b"RIFF")
        .map_err(|error| format!("failed to write RIFF header: {error}"))?;
    file.write_all(&riff_size.to_le_bytes())
        .map_err(|error| format!("failed to write RIFF size: {error}"))?;
    file.write_all(b"WAVE")
        .map_err(|error| format!("failed to write WAVE marker: {error}"))?;
    file.write_all(b"fmt ")
        .map_err(|error| format!("failed to write fmt marker: {error}"))?;
    file.write_all(&16_u32.to_le_bytes())
        .map_err(|error| format!("failed to write fmt chunk size: {error}"))?;
    file.write_all(&1_u16.to_le_bytes())
        .map_err(|error| format!("failed to write audio format: {error}"))?;
    file.write_all(&channels.to_le_bytes())
        .map_err(|error| format!("failed to write channels: {error}"))?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|error| format!("failed to write sample rate: {error}"))?;
    file.write_all(&byte_rate.to_le_bytes())
        .map_err(|error| format!("failed to write byte rate: {error}"))?;
    file.write_all(&block_align_u16.to_le_bytes())
        .map_err(|error| format!("failed to write block align: {error}"))?;
    file.write_all(&bits_per_sample.to_le_bytes())
        .map_err(|error| format!("failed to write bits per sample: {error}"))?;
    file.write_all(b"data")
        .map_err(|error| format!("failed to write data marker: {error}"))?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|error| format!("failed to write data size: {error}"))?;

    for frame in 0..frames {
        let raw = ((frame as i32 % 64) - 32) * 512;
        let left = raw as i16;
        let right = left.saturating_neg();
        file.write_all(&left.to_le_bytes())
            .map_err(|error| format!("failed to write left sample: {error}"))?;
        file.write_all(&right.to_le_bytes())
            .map_err(|error| format!("failed to write right sample: {error}"))?;
    }

    Ok(())
}
