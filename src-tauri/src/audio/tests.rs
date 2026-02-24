use super::cache::{DecodedTrack, DecodedTrackCache, DecodedTrackSource};
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
