use super::super::migrations::run_migrations;
use super::super::Database;
use super::{seed_song, test_db};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

#[test]
fn supports_phase_2_song_sorts_and_aggregates() {
    let connection = Connection::open_in_memory().expect("failed to open in-memory db");
    run_migrations(&connection).expect("failed to run migrations");

    connection
        .execute(
            "
                INSERT INTO songs (
                    id, file_path, title, artist, album, duration_ms, play_count, date_added
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
            params![
                "song-1",
                "/music/one.mp3",
                "Alpha",
                "Artist A",
                "Album One",
                3000_i64,
                5_i64,
                "2024-01-01T00:00:00Z"
            ],
        )
        .expect("failed to insert first song");

    connection
        .execute(
            "
                INSERT INTO songs (
                    id, file_path, title, artist, album, duration_ms, play_count, date_added
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
            params![
                "song-2",
                "/music/two.mp3",
                "Beta",
                "Artist B",
                "Album Two",
                1000_i64,
                20_i64,
                "2024-01-02T00:00:00Z"
            ],
        )
        .expect("failed to insert second song");

    let db = Database {
        connection: Mutex::new(connection),
        search_connection: None,
        artwork_dir: PathBuf::from("/tmp"),
    };

    let songs_by_play_count = db
        .get_songs(10, 0, "play_count", "desc", &[])
        .expect("failed to sort songs by play count");
    assert_eq!(songs_by_play_count[0].id, "song-2");

    let albums = db
        .get_albums(10, 0, "name", "asc")
        .expect("failed to query albums");
    assert_eq!(albums.len(), 2);

    let artists = db
        .get_artists(10, 0, "name", "asc")
        .expect("failed to query artists");
    assert_eq!(artists.len(), 2);
}

#[test]
fn supports_phase_4_tags_crud_assignment_and_filters() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");
    seed_song(&db, "song-3", "Song 3");

    let chill = db
        .tags_create("Chill", "#A8D8EA")
        .expect("failed to create chill tag");
    let road = db
        .tags_create("Road", "#FFC0CB")
        .expect("failed to create road tag");

    db.tags_assign(
        &[String::from("song-1"), String::from("song-2")],
        std::slice::from_ref(&chill.id),
    )
    .expect("failed to assign chill tag");
    db.tags_assign(&[String::from("song-2")], std::slice::from_ref(&road.id))
        .expect("failed to assign road tag");

    let chill_count = db
        .get_song_count(std::slice::from_ref(&chill.id))
        .expect("failed to count chill songs");
    assert_eq!(chill_count, 2);

    let chill_and_road_count = db
        .get_song_count(&[chill.id.clone(), road.id.clone()])
        .expect("failed to count chill+road songs");
    assert_eq!(chill_and_road_count, 1);

    let chill_search = db
        .search_library("tag:chill", 25, &[])
        .expect("failed to search by inline tag");
    assert_eq!(chill_search.songs.len(), 2);
    assert_eq!(chill_search.playlists.len(), 0);
    assert_eq!(chill_search.folders.len(), 0);

    let renamed = db
        .tags_rename(&chill.id, "Calm")
        .expect("failed to rename tag");
    assert_eq!(renamed.name, "Calm");
    let recolored = db
        .tags_set_color(&chill.id, "#99AA77")
        .expect("failed to recolor tag");
    assert_eq!(recolored.color, "#99AA77");

    db.tags_delete(&road.id).expect("failed to delete road tag");
    let remaining_tags = db.tags_list().expect("failed to list tags");
    assert_eq!(remaining_tags.len(), 1);
    assert_eq!(remaining_tags[0].id, chill.id);
}

#[test]
fn supports_phase_4_comment_custom_start_and_missing_song_filtering() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");

    db.song_update_comment("song-1", Some("favorite intro"))
        .expect("failed to update comment");
    db.song_set_custom_start("song-1", 12_000)
        .expect("failed to update custom start");

    let songs = db
        .get_songs(10, 0, "title", "asc", &[])
        .expect("failed to list songs");
    let song_1 = songs
        .iter()
        .find(|song| song.id == "song-1")
        .expect("missing song-1");
    assert_eq!(song_1.comment.as_deref(), Some("favorite intro"));
    assert_eq!(song_1.custom_start_ms, 12_000);

    db.mark_songs_missing_by_paths(&[String::from("/music/song-1.mp3")])
        .expect("failed to mark missing song");

    let visible_count = db
        .get_song_count(&[])
        .expect("failed to count visible songs");
    assert_eq!(visible_count, 1);

    let playback_error = db
        .get_song_for_playback("song-1")
        .expect_err("missing song should not be playable");
    assert!(playback_error.contains("failed to load song for playback"));
}
