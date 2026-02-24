use rodio::Source;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub(super) struct DecodedTrack {
    pub(super) samples: Arc<[f32]>,
    pub(super) channels: u16,
    pub(super) sample_rate: u32,
    pub(super) duration_ms: u64,
}

impl DecodedTrack {
    fn size_bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<f32>()
    }
}

pub(super) struct CachedDecodedTrack {
    pub(super) track: DecodedTrack,
    pub(super) size_bytes: usize,
}

pub(super) struct DecodedTrackCache {
    max_bytes: usize,
    total_bytes: usize,
    order: VecDeque<String>,
    entries: HashMap<String, CachedDecodedTrack>,
}

pub(super) struct DecodedTrackSource {
    samples: Arc<[f32]>,
    position: usize,
    channels: u16,
    sample_rate: u32,
    total_duration: Duration,
}

impl DecodedTrackSource {
    pub(super) fn new(track: DecodedTrack, start_ms: u64) -> Self {
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
    pub(super) fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            total_bytes: 0,
            order: VecDeque::new(),
            entries: HashMap::new(),
        }
    }

    pub(super) fn get(&mut self, key: &str) -> Option<DecodedTrack> {
        let track = self.entries.get(key).map(|entry| entry.track.clone())?;
        self.touch(key);
        Some(track)
    }

    pub(super) fn insert(&mut self, key: String, track: DecodedTrack) {
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
        self.entries
            .insert(key, CachedDecodedTrack { track, size_bytes });
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|existing| existing != key);
        self.order.push_back(key.to_string());
    }

    #[cfg(test)]
    pub(super) fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    #[cfg(test)]
    pub(super) fn total_bytes(&self) -> usize {
        self.total_bytes
    }
}
