use super::cache::DecodedTrack;
use rodio::source::SeekError;
use rodio::{Decoder, Sink, Source};
use std::any::Any;
use std::fs::File;
use std::io::{BufReader, Error as IoError, ErrorKind as IoErrorKind};
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use symphonia::default::{get_codecs, get_probe};

const DEFAULT_CHANNELS: u16 = 2;
const DEFAULT_SAMPLE_RATE: u32 = 44_100;
const MAX_CONSECUTIVE_DECODE_ERRORS: usize = 3;

pub(super) fn try_append_streaming_source(
    sink: &Sink,
    file_path: &str,
    start_ms: u64,
) -> Result<(), String> {
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

pub(super) fn try_append_symphonia_streaming_source(
    sink: &Sink,
    file_path: &str,
    start_ms: u64,
) -> Result<(), String> {
    let source = SymphoniaStreamingSource::new(file_path, start_ms)?;
    sink.append(source);
    Ok(())
}

pub(super) struct SymphoniaStreamingSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    channels: u16,
    sample_rate: u32,
    total_duration: Option<Duration>,
    buffered_samples: Vec<f32>,
    buffered_index: usize,
    pending_skip_samples: usize,
    consecutive_decode_errors: usize,
    exhausted: bool,
}

impl SymphoniaStreamingSource {
    pub(super) fn new(file_path: &str, start_ms: u64) -> Result<Self, String> {
        let file = File::open(file_path).map_err(|error| {
            format!("failed to open audio file for symphonia streaming: {error}")
        })?;

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

        let probed = get_probe()
            .format(
                &hint,
                source_stream,
                &format_opts,
                &MetadataOptions::default(),
            )
            .map_err(|error| {
                format!("failed to probe audio format for symphonia streaming: {error}")
            })?;

        let track = probed
            .format
            .tracks()
            .iter()
            .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| {
                String::from("no decodable audio track found for symphonia streaming")
            })?;

        let track_id = track.id;
        let total_duration = track
            .codec_params
            .time_base
            .zip(track.codec_params.n_frames)
            .map(|(base, frames)| Duration::from(base.calc_time(frames)));
        let initial_channels = track
            .codec_params
            .channels
            .map(|channels| channels.count() as u16)
            .unwrap_or(DEFAULT_CHANNELS);
        let initial_sample_rate = track
            .codec_params
            .sample_rate
            .unwrap_or(DEFAULT_SAMPLE_RATE);

        let decoder = get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|error| {
                format!("failed to initialize symphonia streaming decoder: {error}")
            })?;

        let mut source = Self {
            format: probed.format,
            decoder,
            track_id,
            channels: initial_channels,
            sample_rate: initial_sample_rate,
            total_duration,
            buffered_samples: Vec::new(),
            buffered_index: 0,
            pending_skip_samples: 0,
            consecutive_decode_errors: 0,
            exhausted: false,
        };

        source.apply_start_offset(start_ms);
        Ok(source)
    }

    fn apply_start_offset(&mut self, start_ms: u64) {
        if start_ms == 0 {
            return;
        }

        let bounded_start_ms = self
            .total_duration
            .map(|duration| start_ms.min(duration.as_millis() as u64))
            .unwrap_or(start_ms);

        match self.seek_internal(Duration::from_millis(bounded_start_ms)) {
            Ok(()) => {
                log::debug!(
                    "symphonia streaming source initialized with seek start_ms={}",
                    bounded_start_ms
                );
            }
            Err(error) => {
                self.pending_skip_samples =
                    ms_to_sample_count(bounded_start_ms, self.sample_rate, self.channels);
                log::debug!(
                    "symphonia streaming seek unavailable during initialization; falling back to sample skip: start_ms={} skip_samples={} error={}",
                    bounded_start_ms,
                    self.pending_skip_samples,
                    error
                );
            }
        }
    }

    fn seek_internal(&mut self, position: Duration) -> Result<(), SymphoniaError> {
        self.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::from(position),
                track_id: Some(self.track_id),
            },
        )?;
        self.decoder.reset();
        self.buffered_samples.clear();
        self.buffered_index = 0;
        self.pending_skip_samples = 0;
        self.consecutive_decode_errors = 0;
        self.exhausted = false;
        Ok(())
    }

    fn refill_buffer(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(_)) => return false,
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(error) => {
                    log::warn!("symphonia streaming packet read failed: {error}");
                    return false;
                }
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            let decoded = match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    self.consecutive_decode_errors = 0;
                    decoded
                }
                Err(SymphoniaError::DecodeError(error)) => {
                    self.consecutive_decode_errors += 1;
                    if self.consecutive_decode_errors > MAX_CONSECUTIVE_DECODE_ERRORS {
                        log::warn!(
                            "symphonia streaming aborted after repeated decode errors: {error}"
                        );
                        return false;
                    }
                    log::debug!(
                        "symphonia streaming decode error (retry {}/{}): {}",
                        self.consecutive_decode_errors,
                        MAX_CONSECUTIVE_DECODE_ERRORS,
                        error
                    );
                    continue;
                }
                Err(SymphoniaError::IoError(_)) => return false,
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(error) => {
                    log::warn!("symphonia streaming decode failed: {error}");
                    return false;
                }
            };

            self.channels = decoded.spec().channels.count() as u16;
            self.sample_rate = decoded.spec().rate;

            let mut sample_buffer =
                SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            sample_buffer.copy_interleaved_ref(decoded);

            self.buffered_samples.clear();
            self.buffered_samples
                .extend_from_slice(sample_buffer.samples());
            self.buffered_index = 0;
            self.consume_pending_skip();

            if self.buffered_index < self.buffered_samples.len() {
                return true;
            }
        }
    }

    fn consume_pending_skip(&mut self) {
        if self.pending_skip_samples == 0 {
            return;
        }

        let available = self
            .buffered_samples
            .len()
            .saturating_sub(self.buffered_index);
        let to_skip = available.min(self.pending_skip_samples);
        self.buffered_index += to_skip;
        self.pending_skip_samples -= to_skip;
    }
}

impl Iterator for SymphoniaStreamingSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if self.buffered_index < self.buffered_samples.len() {
                let sample = self.buffered_samples.get(self.buffered_index).copied();
                self.buffered_index += 1;
                return sample;
            }

            if self.exhausted {
                return None;
            }

            if !self.refill_buffer() {
                self.exhausted = true;
                return None;
            }
        }
    }
}

impl Source for SymphoniaStreamingSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(
            self.buffered_samples
                .len()
                .saturating_sub(self.buffered_index),
        )
    }

    fn channels(&self) -> u16 {
        self.channels.max(1)
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate.max(1)
    }

    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.seek_internal(pos).map_err(|error| {
            SeekError::Other(Box::new(IoError::new(
                IoErrorKind::Other,
                format!("symphonia streaming seek failed: {error}"),
            )))
        })
    }
}

pub(super) fn decode_track_with_symphonia(file_path: &str) -> Result<DecodedTrack, String> {
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

    Ok(DecodedTrack {
        samples: Arc::from(samples),
        channels,
        sample_rate,
    })
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

fn ms_to_sample_count(start_ms: u64, sample_rate: u32, channels: u16) -> usize {
    let frame_offset = start_ms.saturating_mul(sample_rate as u64) / 1000;
    let sample_offset = frame_offset.saturating_mul(channels.max(1) as u64);
    sample_offset.min(usize::MAX as u64) as usize
}
