use super::migrations::run_migrations;
use super::Database;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

mod migrations;
mod playlists;
mod search;
mod songs_tags_settings;
mod stats_exports;

pub(super) fn test_db() -> Database {
    let connection = Connection::open_in_memory().expect("failed to open in-memory db");
    run_migrations(&connection).expect("failed to run migrations");
    Database {
        connection: Mutex::new(connection),
        search_connection: None,
        artwork_dir: PathBuf::from("/tmp"),
    }
}

pub(super) fn seed_song(db: &Database, song_id: &str, title: &str) {
    let connection = db.connection.lock().expect("failed to lock db");
    connection
        .execute(
            "
            INSERT INTO songs (id, file_path, title, artist, album, duration_ms, play_count, date_added)
            VALUES (?1, ?2, ?3, 'Artist', 'Album', 1000, 0, '2024-01-01T00:00:00Z')
            ",
            params![song_id, format!("/music/{song_id}.mp3"), title],
        )
        .expect("failed to insert test song");
}
