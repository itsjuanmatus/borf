use crate::db::{Database, ItunesSongDbUpdate, PlaylistImportData, SongMatchCandidate};
use plist::Value;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, Emitter};

const MATCH_DURATION_TOLERANCE_MS: i64 = 2_000;

#[derive(Debug, Clone, Deserialize)]
pub struct ItunesImportOptions {
    #[serde(default = "default_true")]
    pub import_play_counts: bool,
    #[serde(default = "default_true")]
    pub import_ratings: bool,
    #[serde(default = "default_true")]
    pub import_comments: bool,
    #[serde(default = "default_true")]
    pub import_playlists: bool,
}

impl Default for ItunesImportOptions {
    fn default() -> Self {
        Self {
            import_play_counts: true,
            import_ratings: true,
            import_comments: true,
            import_playlists: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesPreview {
    pub tracks_found: usize,
    pub playlists_found: usize,
    pub matched_tracks: usize,
    pub unmatched_tracks: usize,
    pub skipped_smart_playlists: usize,
    pub skipped_system_playlists: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesImportSummary {
    pub tracks_found: usize,
    pub playlists_found: usize,
    pub matched_tracks: usize,
    pub unmatched_tracks: usize,
    pub imported_song_updates: usize,
    pub imported_playlists: usize,
    pub skipped_smart_playlists: usize,
    pub skipped_system_playlists: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesImportProgressEvent {
    pub stage: String,
    pub processed: usize,
    pub total: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub current_item: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedTrack {
    track_id: i64,
    title: String,
    artist: String,
    duration_ms: Option<i64>,
    location: Option<String>,
    play_count: Option<i64>,
    skip_count: Option<i64>,
    rating: Option<i64>,
    rating_computed: bool,
    comments: Option<String>,
    date_added: Option<String>,
    play_date_utc: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedPlaylist {
    name: String,
    is_smart: bool,
    is_system: bool,
    track_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
struct ParsedLibrary {
    tracks: Vec<ParsedTrack>,
    playlists: Vec<ParsedPlaylist>,
}

#[derive(Debug, Clone)]
struct MatchContext {
    by_normalized_path: HashMap<String, String>,
    by_signature: HashMap<String, Vec<DurationMatchCandidate>>,
}

#[derive(Debug, Clone)]
struct DurationMatchCandidate {
    song_id: String,
    duration_ms: i64,
}

#[derive(Debug, Clone)]
struct TrackMatchResult {
    matched_song_id: Option<String>,
    update: Option<ItunesSongDbUpdate>,
}

pub fn preview_itunes_import(db: &Database, xml_path: &Path) -> Result<ItunesPreview, String> {
    let parsed = parse_itunes_library(xml_path)?;
    let match_context = build_match_context(&db.get_song_match_candidates()?);

    let mut matched = 0_usize;
    let mut unmatched = 0_usize;

    for track in &parsed.tracks {
        if match_track(track, &match_context).matched_song_id.is_some() {
            matched += 1;
        } else {
            unmatched += 1;
        }
    }

    let (playlists_found, skipped_smart_playlists, skipped_system_playlists) =
        playlist_preview_counts(&parsed.playlists);

    Ok(ItunesPreview {
        tracks_found: parsed.tracks.len(),
        playlists_found,
        matched_tracks: matched,
        unmatched_tracks: unmatched,
        skipped_smart_playlists,
        skipped_system_playlists,
    })
}

pub fn run_itunes_import(
    app_handle: &AppHandle,
    db: &Database,
    xml_path: &Path,
    options: ItunesImportOptions,
) -> Result<ItunesImportSummary, String> {
    emit_progress(
        app_handle,
        "parsing",
        0,
        1,
        0,
        0,
        Some(String::from("Reading iTunes Library.xml")),
    );

    let parsed = parse_itunes_library(xml_path)?;
    let match_context = build_match_context(&db.get_song_match_candidates()?);

    emit_progress(
        app_handle,
        "matching",
        0,
        parsed.tracks.len(),
        0,
        0,
        None,
    );

    let mut matched_track_ids_by_itunes_track_id = HashMap::new();
    let mut updates = Vec::<ItunesSongDbUpdate>::new();
    let mut matched_tracks = 0_usize;
    let mut unmatched_tracks = 0_usize;

    for (index, track) in parsed.tracks.iter().enumerate() {
        let match_result = match_track(track, &match_context);

        if let Some(song_id) = match_result.matched_song_id {
            matched_track_ids_by_itunes_track_id.insert(track.track_id, song_id);
            matched_tracks += 1;
        } else {
            unmatched_tracks += 1;
        }

        if let Some(update) = match_result.update {
            updates.push(update);
        }

        if index == parsed.tracks.len().saturating_sub(1) || index % 250 == 0 {
            emit_progress(
                app_handle,
                "matching",
                index + 1,
                parsed.tracks.len(),
                matched_tracks,
                unmatched_tracks,
                Some(track.title.clone()),
            );
        }
    }

    let mut playlist_imports = Vec::<PlaylistImportData>::new();
    let mut playlists_found = 0_usize;
    let mut skipped_smart_playlists = 0_usize;
    let mut skipped_system_playlists = 0_usize;

    if options.import_playlists {
        emit_progress(
            app_handle,
            "playlist-prep",
            0,
            parsed.playlists.len(),
            matched_tracks,
            unmatched_tracks,
            None,
        );

        for (index, playlist) in parsed.playlists.iter().enumerate() {
            if playlist.is_smart {
                skipped_smart_playlists += 1;
                continue;
            }
            if playlist.is_system {
                skipped_system_playlists += 1;
                continue;
            }

            playlists_found += 1;
            let mut matched_song_ids = Vec::new();
            for track_id in &playlist.track_ids {
                if let Some(song_id) = matched_track_ids_by_itunes_track_id.get(track_id) {
                    matched_song_ids.push(song_id.clone());
                }
            }

            playlist_imports.push(PlaylistImportData {
                name: playlist.name.clone(),
                song_ids: matched_song_ids,
            });

            if index == parsed.playlists.len().saturating_sub(1) || index % 100 == 0 {
                emit_progress(
                    app_handle,
                    "playlist-prep",
                    index + 1,
                    parsed.playlists.len(),
                    matched_tracks,
                    unmatched_tracks,
                    Some(playlist.name.clone()),
                );
            }
        }
    } else {
        let (found, smart, system) = playlist_preview_counts(&parsed.playlists);
        playlists_found = found;
        skipped_smart_playlists = smart;
        skipped_system_playlists = system;
    }

    emit_progress(
        app_handle,
        "database",
        0,
        updates.len().max(1),
        matched_tracks,
        unmatched_tracks,
        Some(String::from("Writing import results")),
    );

    db.apply_itunes_import(
        &updates,
        options.import_play_counts,
        options.import_ratings,
        options.import_comments,
        &playlist_imports,
    )?;

    emit_progress(
        app_handle,
        "complete",
        1,
        1,
        matched_tracks,
        unmatched_tracks,
        Some(String::from("iTunes import complete")),
    );

    Ok(ItunesImportSummary {
        tracks_found: parsed.tracks.len(),
        playlists_found,
        matched_tracks,
        unmatched_tracks,
        imported_song_updates: updates.len(),
        imported_playlists: playlist_imports.len(),
        skipped_smart_playlists,
        skipped_system_playlists,
    })
}

fn default_true() -> bool {
    true
}

fn emit_progress(
    app_handle: &AppHandle,
    stage: &str,
    processed: usize,
    total: usize,
    matched: usize,
    unmatched: usize,
    current_item: Option<String>,
) {
    let _ = app_handle.emit(
        "import:itunes-progress",
        ItunesImportProgressEvent {
            stage: String::from(stage),
            processed,
            total,
            matched,
            unmatched,
            current_item,
        },
    );
}

fn playlist_preview_counts(playlists: &[ParsedPlaylist]) -> (usize, usize, usize) {
    let mut found = 0_usize;
    let mut smart = 0_usize;
    let mut system = 0_usize;

    for playlist in playlists {
        if playlist.is_smart {
            smart += 1;
            continue;
        }
        if playlist.is_system {
            system += 1;
            continue;
        }
        found += 1;
    }

    (found, smart, system)
}

fn parse_itunes_library(xml_path: &Path) -> Result<ParsedLibrary, String> {
    let value = Value::from_file(xml_path)
        .map_err(|error| format!("failed to parse iTunes plist at {}: {error}", xml_path.display()))?;

    let root = value
        .as_dictionary()
        .ok_or_else(|| String::from("invalid iTunes plist format: root is not a dictionary"))?;

    let tracks_dict = root
        .get("Tracks")
        .and_then(Value::as_dictionary)
        .ok_or_else(|| String::from("invalid iTunes plist format: missing Tracks dictionary"))?;

    let mut tracks = Vec::new();
    for (track_key, track_value) in tracks_dict {
        let Some(track_dictionary) = track_value.as_dictionary() else {
            continue;
        };

        let track_id = track_dictionary
            .get("Track ID")
            .and_then(value_as_i64)
            .or_else(|| track_key.parse::<i64>().ok())
            .unwrap_or_default();

        let title = normalize_string(track_dictionary.get("Name").and_then(Value::as_string), "Unknown");
        let artist = normalize_string(
            track_dictionary.get("Artist").and_then(Value::as_string),
            "Unknown Artist",
        );

        let duration_ms = track_dictionary.get("Total Time").and_then(value_as_i64);
        let location = track_dictionary
            .get("Location")
            .and_then(Value::as_string)
            .map(String::from);

        let rating = track_dictionary.get("Rating").and_then(value_as_i64);
        let rating_computed = track_dictionary
            .get("Rating Computed")
            .and_then(Value::as_boolean)
            .unwrap_or(false);

        let comments = track_dictionary
            .get("Comments")
            .and_then(Value::as_string)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());

        let date_added = track_dictionary
            .get("Date Added")
            .and_then(value_as_timestamp_string);
        let play_date_utc = track_dictionary
            .get("Play Date UTC")
            .and_then(value_as_timestamp_string);

        tracks.push(ParsedTrack {
            track_id,
            title,
            artist,
            duration_ms,
            location,
            play_count: track_dictionary.get("Play Count").and_then(value_as_i64),
            skip_count: track_dictionary.get("Skip Count").and_then(value_as_i64),
            rating,
            rating_computed,
            comments,
            date_added,
            play_date_utc,
        });
    }

    let playlists = root
        .get("Playlists")
        .and_then(Value::as_array)
        .map(|values| parse_playlists(values.as_slice()))
        .unwrap_or_default();

    Ok(ParsedLibrary { tracks, playlists })
}

fn parse_playlists(values: &[Value]) -> Vec<ParsedPlaylist> {
    let mut playlists = Vec::new();

    for value in values {
        let Some(dictionary) = value.as_dictionary() else {
            continue;
        };

        let name = normalize_string(dictionary.get("Name").and_then(Value::as_string), "Unnamed Playlist");
        let is_smart = dictionary.get("Smart Info").is_some();
        let is_system = dictionary
            .get("Master")
            .and_then(Value::as_boolean)
            .unwrap_or(false)
            || dictionary.contains_key("Distinguished Kind")
            || dictionary
                .get("Folder")
                .and_then(Value::as_boolean)
                .unwrap_or(false);

        let mut track_ids = Vec::new();
        if let Some(items) = dictionary.get("Playlist Items").and_then(Value::as_array) {
            for item in items {
                let Some(item_dictionary) = item.as_dictionary() else {
                    continue;
                };
                if let Some(track_id) = item_dictionary.get("Track ID").and_then(value_as_i64) {
                    track_ids.push(track_id);
                }
            }
        }

        playlists.push(ParsedPlaylist {
            name,
            is_smart,
            is_system,
            track_ids,
        });
    }

    playlists
}

fn build_match_context(candidates: &[SongMatchCandidate]) -> MatchContext {
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

fn match_track(track: &ParsedTrack, context: &MatchContext) -> TrackMatchResult {
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

fn convert_itunes_rating(raw: Option<i64>, rating_computed: bool) -> Option<i64> {
    if rating_computed {
        return None;
    }

    raw.map(|rating| (rating / 20).clamp(0, 5))
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_signed_integer()
        .or_else(|| value.as_unsigned_integer().and_then(|raw| i64::try_from(raw).ok()))
}

fn value_as_timestamp_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_string() {
        return Some(text.to_owned());
    }

    value.as_date().map(|date| date.to_xml_format())
}

fn normalize_string(input: Option<&str>, fallback: &str) -> String {
    input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .unwrap_or_else(|| String::from(fallback))
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

fn signature_for_match(artist: &str, title: &str) -> String {
    format!(
        "{}|{}",
        normalize_text_for_match(artist),
        normalize_text_for_match(title)
    )
}

fn decode_itunes_location(location: &str) -> String {
    let without_scheme = location
        .strip_prefix("file://localhost")
        .or_else(|| location.strip_prefix("file://"))
        .unwrap_or(location);

    percent_decode(without_scheme)
}

fn normalize_path_for_match(path: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::{
        DurationMatchCandidate, MatchContext, ParsedTrack, convert_itunes_rating,
        decode_itunes_location, match_track, normalize_path_for_match, parse_playlists,
        signature_for_match,
    };
    use plist::{Dictionary, Value};
    use std::collections::HashMap;

    #[test]
    fn converts_itunes_rating_when_not_computed() {
        assert_eq!(convert_itunes_rating(Some(0), false), Some(0));
        assert_eq!(convert_itunes_rating(Some(100), false), Some(5));
        assert_eq!(convert_itunes_rating(Some(60), false), Some(3));
        assert_eq!(convert_itunes_rating(Some(80), true), None);
    }

    #[test]
    fn decodes_itunes_file_location() {
        let decoded = decode_itunes_location("file://localhost/Users/juan/Music/AC%2FDC%20Track.mp3");
        assert_eq!(decoded, "/Users/juan/Music/AC/DC Track.mp3");
    }

    #[test]
    fn builds_case_insensitive_match_signature() {
        let left = signature_for_match("The Artist", "Song Name");
        let right = signature_for_match("the artist", "song name");
        assert_eq!(left, right);
        assert_eq!(normalize_path_for_match("C:\\MUSIC\\Song.MP3"), "c:/music/song.mp3");
    }

    #[test]
    fn matches_fallback_signature_with_duration_tolerance() {
        let mut by_signature = HashMap::new();
        by_signature.insert(
            signature_for_match("The Artist", "Song Name"),
            vec![DurationMatchCandidate {
                song_id: String::from("song-123"),
                duration_ms: 200_000,
            }],
        );

        let context = MatchContext {
            by_normalized_path: HashMap::new(),
            by_signature,
        };

        let parsed_track = ParsedTrack {
            track_id: 1,
            title: String::from("Song Name"),
            artist: String::from("The Artist"),
            duration_ms: Some(201_999),
            location: None,
            play_count: None,
            skip_count: None,
            rating: None,
            rating_computed: false,
            comments: None,
            date_added: None,
            play_date_utc: None,
        };

        let result = match_track(&parsed_track, &context);
        assert_eq!(result.matched_song_id, Some(String::from("song-123")));
    }

    #[test]
    fn parses_smart_and_system_playlist_flags() {
        let mut smart_playlist = Dictionary::new();
        smart_playlist.insert(String::from("Name"), Value::String(String::from("Smart")));
        smart_playlist.insert(String::from("Smart Info"), Value::String(String::from("rule")));

        let mut system_playlist = Dictionary::new();
        system_playlist.insert(String::from("Name"), Value::String(String::from("Music")));
        system_playlist.insert(String::from("Master"), Value::Boolean(true));

        let playlists = parse_playlists(&[
            Value::Dictionary(smart_playlist),
            Value::Dictionary(system_playlist),
        ]);

        assert_eq!(playlists.len(), 2);
        assert!(playlists[0].is_smart);
        assert!(!playlists[0].is_system);
        assert!(!playlists[1].is_smart);
        assert!(playlists[1].is_system);
    }
}
