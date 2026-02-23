use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const MIGRATION_0001: &str = include_str!("../../migrations/0001_phase1.sql");

#[derive(Debug, Clone)]
pub struct DbSongUpsert {
    pub id: String,
    pub file_path: String,
    pub file_hash: Option<String>,
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub track_number: Option<i64>,
    pub disc_number: i64,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub duration_ms: i64,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub artwork_path: Option<String>,
    pub file_modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SongListItem {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub artwork_path: Option<String>,
    pub file_path: String,
    pub custom_start_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SongPlaybackInfo {
    pub id: String,
    pub duration_ms: i64,
    pub file_path: String,
    pub custom_start_ms: i64,
}

pub struct Database {
    connection: Mutex<Connection>,
    artwork_dir: PathBuf,
}

impl Database {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("failed to create app data dir: {error}"))?;

        let db_path = app_data_dir.join("borf.db");
        let connection = Connection::open(&db_path)
            .map_err(|error| format!("failed to open sqlite database: {error}"))?;

        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| format!("failed to enable sqlite pragmas: {error}"))?;

        run_migrations(&connection)
            .map_err(|error| format!("failed to run migrations: {error}"))?;

        let cache_dir = app_handle
            .path()
            .app_cache_dir()
            .map_err(|error| format!("failed to resolve app cache dir: {error}"))?;
        let artwork_dir = cache_dir.join("artwork");
        fs::create_dir_all(&artwork_dir)
            .map_err(|error| format!("failed to create artwork cache dir: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
            artwork_dir,
        })
    }

    pub fn artwork_dir(&self) -> PathBuf {
        self.artwork_dir.clone()
    }

    pub fn upsert_songs(&self, songs: &[DbSongUpsert]) -> Result<(), String> {
        if songs.is_empty() {
            return Ok(());
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start transaction: {error}"))?;

        {
            let mut statement = transaction
                .prepare(
                    "
                INSERT INTO songs (
                    id,
                    file_path,
                    file_hash,
                    title,
                    artist,
                    album_artist,
                    album,
                    track_number,
                    disc_number,
                    year,
                    genre,
                    duration_ms,
                    codec,
                    bitrate,
                    sample_rate,
                    artwork_path,
                    file_modified_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                ON CONFLICT(file_path) DO UPDATE SET
                    file_hash = excluded.file_hash,
                    title = excluded.title,
                    artist = excluded.artist,
                    album_artist = excluded.album_artist,
                    album = excluded.album,
                    track_number = excluded.track_number,
                    disc_number = excluded.disc_number,
                    year = excluded.year,
                    genre = excluded.genre,
                    duration_ms = excluded.duration_ms,
                    codec = excluded.codec,
                    bitrate = excluded.bitrate,
                    sample_rate = excluded.sample_rate,
                    artwork_path = COALESCE(excluded.artwork_path, songs.artwork_path),
                    file_modified_at = excluded.file_modified_at,
                    updated_at = CURRENT_TIMESTAMP
                ",
                )
                .map_err(|error| format!("failed to prepare upsert statement: {error}"))?;

            for song in songs {
                statement
                    .execute(params![
                        song.id,
                        song.file_path,
                        song.file_hash,
                        song.title,
                        song.artist,
                        song.album_artist,
                        song.album,
                        song.track_number,
                        song.disc_number,
                        song.year,
                        song.genre,
                        song.duration_ms,
                        song.codec,
                        song.bitrate,
                        song.sample_rate,
                        song.artwork_path,
                        song.file_modified_at,
                    ])
                    .map_err(|error| {
                        format!("failed to upsert song {}: {error}", song.file_path)
                    })?;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit transaction: {error}"))
    }

    pub fn get_songs(
        &self,
        limit: u32,
        offset: u32,
        sort: &str,
        order: &str,
    ) -> Result<Vec<SongListItem>, String> {
        let sort_column = match sort {
            "title" => "title COLLATE NOCASE",
            "artist" => "artist COLLATE NOCASE",
            "album" => "album COLLATE NOCASE",
            "date_added" => "date_added",
            _ => "title COLLATE NOCASE",
        };

        let sort_order = if order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };

        let query = format!(
            "
            SELECT
                id,
                title,
                artist,
                album,
                duration_ms,
                artwork_path,
                file_path,
                custom_start_ms
            FROM songs
            ORDER BY {sort_column} {sort_order}
            LIMIT ?1 OFFSET ?2
            "
        );

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("failed to prepare songs query: {error}"))?;

        let rows = statement
            .query_map(params![limit, offset], |row| {
                Ok(SongListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                    artwork_path: row.get(5)?,
                    file_path: row.get(6)?,
                    custom_start_ms: row.get(7)?,
                })
            })
            .map_err(|error| format!("failed to query songs: {error}"))?;

        let mut songs = Vec::new();
        for row in rows {
            songs.push(row.map_err(|error| format!("failed to read song row: {error}"))?);
        }

        Ok(songs)
    }

    pub fn get_song_for_playback(&self, song_id: &str) -> Result<SongPlaybackInfo, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .query_row(
                "
                SELECT
                    id,
                    duration_ms,
                    file_path,
                    custom_start_ms
                FROM songs
                WHERE id = ?1
                ",
                params![song_id],
                |row| {
                    Ok(SongPlaybackInfo {
                        id: row.get(0)?,
                        duration_ms: row.get(1)?,
                        file_path: row.get(2)?,
                        custom_start_ms: row.get(3)?,
                    })
                },
            )
            .map_err(|error| format!("failed to load song for playback: {error}"))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .execute(
                "
                INSERT INTO settings (key, value)
                VALUES (?1, ?2)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value
                ",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|error| format!("failed to set setting {key}: {error}"))
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to read setting {key}: {error}"))
    }

    pub fn get_volume(&self) -> Result<f32, String> {
        let raw = self.get_setting("volume")?;
        match raw {
            Some(value) => value
                .parse::<f32>()
                .map(|parsed| parsed.clamp(0.0, 1.0))
                .map_err(|error| format!("invalid persisted volume value: {error}")),
            None => Ok(0.8),
        }
    }
}

pub fn to_sqlite_timestamp(datetime: DateTime<Utc>) -> String {
    datetime.to_rfc3339()
}

fn run_migrations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;

    let migration_1_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 1)",
        [],
        |row| row.get(0),
    )?;

    if !migration_1_applied {
        connection.execute_batch(MIGRATION_0001)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (1)", [])?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run_migrations;
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

        assert_eq!(songs_table_exists, 1);
        assert_eq!(fts_table_exists, 1);
    }
}
