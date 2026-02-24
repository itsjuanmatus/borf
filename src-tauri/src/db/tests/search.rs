use super::super::search::build_fts_query;
use super::{seed_song, test_db};

#[test]
fn builds_expected_fts_query() {
    assert_eq!(
        build_fts_query("hello world"),
        Some(String::from("hello* AND world*"))
    );
    assert_eq!(build_fts_query("hello!!!"), Some(String::from("hello*")));
    assert_eq!(build_fts_query("   "), None);
}
#[test]
fn search_library_includes_global_playlist_and_folder_hits() {
    let db = test_db();
    seed_song(&db, "song-1", "Road Anthem");

    let folder = db
        .playlist_create("Road Trips", None, true)
        .expect("failed to create folder");
    let playlist = db
        .playlist_create("Road Mix", Some(&folder.id), false)
        .expect("failed to create playlist");

    let result = db
        .search_library("road", 25, &[])
        .expect("failed to search library");

    assert!(result.songs.iter().any(|song| song.id == "song-1"));
    assert!(result.songs.iter().all(|song| song.tags.is_empty()));
    assert!(result.playlists.iter().any(|item| item.id == playlist.id));
    assert!(result
        .playlists
        .iter()
        .any(|item| item.id == playlist.id && item.parent_name.as_deref() == Some("Road Trips")));
    assert!(result.folders.iter().any(|item| item.id == folder.id));
}

#[test]
fn search_library_playlist_parent_rename_updates_fts_hits() {
    let db = test_db();
    let folder = db
        .playlist_create("Road Trips", None, true)
        .expect("failed to create parent folder");
    let playlist = db
        .playlist_create("Night Mix", Some(&folder.id), false)
        .expect("failed to create playlist");

    let before = db
        .search_library("road", 25, &[])
        .expect("failed to search before rename");
    assert!(before
        .playlists
        .iter()
        .any(|item| item.id == playlist.id && item.parent_name.as_deref() == Some("Road Trips")));

    db.playlist_rename(&folder.id, "Driving Tunes")
        .expect("failed to rename parent folder");

    let after = db
        .search_library("driving", 25, &[])
        .expect("failed to search after rename");
    assert!(
        after
            .playlists
            .iter()
            .any(|item| item.id == playlist.id
                && item.parent_name.as_deref() == Some("Driving Tunes"))
    );
}

#[test]
fn search_palette_supports_prefix_and_tag_scoring() {
    let db = test_db();
    seed_song(&db, "song-road-prefix", "Road Anthem");
    seed_song(&db, "song-road-contains", "Night Road Mix");
    seed_song(&db, "song-track", "Track Runner");

    let chill = db
        .tags_create("Chill", "#A8D8EA")
        .expect("failed to create chill tag");
    db.tags_assign(
        &[
            String::from("song-road-prefix"),
            String::from("song-road-contains"),
        ],
        std::slice::from_ref(&chill.id),
    )
    .expect("failed to assign chill tags");

    let road = db
        .search_palette("road", 30, &[])
        .expect("failed to search palette for road");
    let song_positions = road
        .items
        .iter()
        .filter_map(|item| item.song.as_ref())
        .map(|song| song.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        song_positions.first().copied(),
        Some("song-road-prefix"),
        "expected prefix song to rank ahead of contains-only song"
    );
    assert!(road
        .items
        .iter()
        .all(|item| item.score >= 0.0 && item.score <= 1.0));

    let tag_filtered = db
        .search_palette("tag:chill", 30, &[])
        .expect("failed to search palette by inline tag");
    assert!(tag_filtered
        .items
        .iter()
        .filter_map(|item| item.song.as_ref())
        .all(|song| song.id == "song-road-prefix" || song.id == "song-road-contains"));

    let synonym_query = db
        .search_palette("tune", 30, &[])
        .expect("failed to search palette by semantic synonym");
    assert!(synonym_query
        .items
        .iter()
        .any(|item| item.song.as_ref().map(|song| song.id.as_str()) == Some("song-track")));
}
