use super::cache::DecodedTrack;
use rodio::{Decoder, Sink, Source};
use std::any::Any;
use std::fs::File;
use std::io::BufReader;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

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

    let frame_count = samples.len() as f64 / channels as f64;
    let duration_ms = (frame_count * 1000.0 / sample_rate as f64).round() as u64;

    Ok(DecodedTrack {
        samples: Arc::from(samples),
        channels,
        sample_rate,
        duration_ms,
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
