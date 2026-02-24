use super::types::{DurationMatchCandidate, MatchContext, ParsedTrack, TrackMatchResult};
use crate::db::{ItunesSongDbUpdate, SongMatchCandidate};
use std::collections::HashMap;

const MATCH_DURATION_TOLERANCE_MS: i64 = 2_000;

pub(super) fn build_match_context(candidates: &[SongMatchCandidate]) -> MatchContext {
    let mut by_normalized_path = HashMap::new();
    let mut by_signature = HashMap::<String, Vec<DurationMatchCandidate>>::new();

    for candidate in candidates {
        let normalized_path = normalize_path_for_match(&candidate.file_path);
        by_normalized_path.insert(normalized_path, candidate.id.clone());

        let signature = signature_for_match(&candidate.artist, &candidate.title);
        by_signature
            .entry(signature)
            .or_default()
            .push(DurationMatchCandidate {
                song_id: candidate.id.clone(),
                duration_ms: candidate.duration_ms,
            });
    }

    MatchContext {
        by_normalized_path,
        by_signature,
    }
}

pub(super) fn match_track(track: &ParsedTrack, context: &MatchContext) -> TrackMatchResult {
    let mut matched_song_id = None;

    if let Some(location) = &track.location {
        let normalized_location = normalize_path_for_match(&decode_itunes_location(location));
        if let Some(song_id) = context.by_normalized_path.get(&normalized_location) {
            matched_song_id = Some(song_id.clone());
        }
    }

    if matched_song_id.is_none() {
        let signature = signature_for_match(&track.artist, &track.title);
        if let Some(candidates) = context.by_signature.get(&signature) {
            let best = candidates.iter().find(|candidate| {
                if let Some(duration_ms) = track.duration_ms {
                    (candidate.duration_ms - duration_ms).abs() <= MATCH_DURATION_TOLERANCE_MS
                } else {
                    true
                }
            });

            if let Some(best) = best {
                matched_song_id = Some(best.song_id.clone());
            }
        }
    }

    let update = matched_song_id.as_ref().map(|song_id| ItunesSongDbUpdate {
        song_id: song_id.clone(),
        play_count: track.play_count,
        skip_count: track.skip_count,
        rating: convert_itunes_rating(track.rating, track.rating_computed),
        comment: track.comments.clone(),
        date_added: track.date_added.clone(),
        last_played_at: track.play_date_utc.clone(),
    });

    TrackMatchResult {
        matched_song_id,
        update,
    }
}

pub(super) fn convert_itunes_rating(raw: Option<i64>, rating_computed: bool) -> Option<i64> {
    if rating_computed {
        return None;
    }

    raw.map(|rating| (rating / 20).clamp(0, 5))
}

fn normalize_text_for_match(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || character.is_ascii_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(super) fn signature_for_match(artist: &str, title: &str) -> String {
    format!(
        "{}|{}",
        normalize_text_for_match(artist),
        normalize_text_for_match(title)
    )
}

pub(super) fn decode_itunes_location(location: &str) -> String {
    let without_scheme = location
        .strip_prefix("file://localhost")
        .or_else(|| location.strip_prefix("file://"))
        .unwrap_or(location);

    percent_decode(without_scheme)
}

pub(super) fn normalize_path_for_match(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::<u8>::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1];
            let lo = bytes[index + 2];
            let hex = [hi, lo];

            if let Ok(hex_str) = std::str::from_utf8(&hex) {
                if let Ok(value) = u8::from_str_radix(hex_str, 16) {
                    decoded.push(value);
                    index += 3;
                    continue;
                }
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}
