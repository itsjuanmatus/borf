use super::super::migrations::run_migrations;
use rusqlite::Connection;

#[test]
fn migration_is_idempotent() {
    let connection = Connection::open_in_memory().expect("failed to open in-memory db");

    run_migrations(&connection).expect("first migration pass failed");
    run_migrations(&connection).expect("second migration pass failed");

    let songs_table_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs'",
            [],
            |row| row.get(0),
        )
        .expect("failed to check songs table existence");

    let fts_table_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs_fts'",
            [],
            |row| row.get(0),
        )
        .expect("failed to check songs_fts table existence");

    let playlists_table_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'playlists'",
            [],
            |row| row.get(0),
        )
        .expect("failed to check playlists table existence");

    let playlist_tracks_table_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'playlist_tracks'",
            [],
            |row| row.get(0),
        )
        .expect("failed to check playlist_tracks table existence");

    assert_eq!(songs_table_exists, 1);
    assert_eq!(fts_table_exists, 1);
    assert_eq!(playlists_table_exists, 1);
    assert_eq!(playlist_tracks_table_exists, 1);

    let migration_5_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
            [],
            |row| row.get(0),
        )
        .expect("failed to check migration 5");
    assert_eq!(migration_5_applied, 1);

    let migration_6_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
            [],
            |row| row.get(0),
        )
        .expect("failed to check migration 6");
    assert_eq!(migration_6_applied, 1);

    let migration_7_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
            [],
            |row| row.get(0),
        )
        .expect("failed to check migration 7");
    assert_eq!(migration_7_applied, 1);

    let migration_8_applied: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 8",
            [],
            |row| row.get(0),
        )
        .expect("failed to check migration 8");
    assert_eq!(migration_8_applied, 1);

    let playlist_search_index_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_playlists_is_folder_name_nocase'",
                [],
                |row| row.get(0),
            )
            .expect("failed to check playlist search index");
    assert_eq!(playlist_search_index_exists, 1);

    let playlists_fts_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'playlists_fts'",
            [],
            |row| row.get(0),
        )
        .expect("failed to check playlists_fts table");
    assert_eq!(playlists_fts_exists, 1);
}
