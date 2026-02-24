use super::matcher::{
    convert_itunes_rating, decode_itunes_location, match_track, normalize_path_for_match,
    signature_for_match,
};
use super::parser::parse_playlists;
use super::types::{DurationMatchCandidate, MatchContext, ParsedTrack};
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
    assert_eq!(
        normalize_path_for_match("C:\\MUSIC\\Song.MP3"),
        "c:/music/song.mp3"
    );
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
    smart_playlist.insert(
        String::from("Smart Info"),
        Value::String(String::from("rule")),
    );

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

#[test]
fn parses_folder_hierarchy_metadata() {
    let mut folder = Dictionary::new();
    folder.insert(String::from("Name"), Value::String(String::from("Chill")));
    folder.insert(String::from("Folder"), Value::Boolean(true));
    folder.insert(
        String::from("Playlist Persistent ID"),
        Value::String(String::from("FOLDER-1")),
    );

    let mut child_playlist = Dictionary::new();
    child_playlist.insert(String::from("Name"), Value::String(String::from("Rain")));
    child_playlist.insert(
        String::from("Playlist Persistent ID"),
        Value::String(String::from("PLAYLIST-1")),
    );
    child_playlist.insert(
        String::from("Parent Persistent ID"),
        Value::String(String::from("FOLDER-1")),
    );

    let playlists =
        parse_playlists(&[Value::Dictionary(folder), Value::Dictionary(child_playlist)]);

    assert_eq!(playlists.len(), 2);
    assert!(playlists[0].is_folder);
    assert!(!playlists[0].is_system);
    assert_eq!(playlists[0].external_id, "FOLDER-1");
    assert_eq!(playlists[1].parent_external_id.as_deref(), Some("FOLDER-1"));
    assert_eq!(playlists[1].external_id, "PLAYLIST-1");
}
