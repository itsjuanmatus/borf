use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../../migrations/0001_phase1.sql");
const MIGRATION_0002: &str = include_str!("../../migrations/0002_phase2_itunes.sql");

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
    pub play_count: i64,
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlbumListItem {
    pub album: String,
    pub album_artist: String,
    pub song_count: i64,
    pub total_duration_ms: i64,
    pub artwork_path: Option<String>,
    pub year: Option<i64>,
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtistListItem {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub play_count: i64,
    pub artwork_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibrarySearchResult {
    pub songs: Vec<SongListItem>,
    pub albums: Vec<AlbumListItem>,
    pub artists: Vec<ArtistListItem>,
}

#[derive(Debug, Clone)]
pub struct SongPlaybackInfo {
    pub id: String,
    pub duration_ms: i64,
    pub file_path: String,
    pub custom_start_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SongMatchCandidate {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ItunesSongDbUpdate {
    pub song_id: String,
    pub play_count: Option<i64>,
    pub skip_count: Option<i64>,
    pub rating: Option<i64>,
    pub comment: Option<String>,
    pub date_added: Option<String>,
    pub last_played_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlaylistImportData {
    pub name: String,
    pub song_ids: Vec<String>,
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

    pub fn get_song_count(&self) -> Result<i64, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("failed to count songs: {error}"))
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
            "play_count" => "play_count",
            "duration_ms" => "duration_ms",
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
                custom_start_ms,
                play_count,
                date_added
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
                    play_count: row.get(8)?,
                    date_added: row.get(9)?,
                })
            })
            .map_err(|error| format!("failed to query songs: {error}"))?;

        let mut songs = Vec::new();
        for row in rows {
            songs.push(row.map_err(|error| format!("failed to read song row: {error}"))?);
        }

        Ok(songs)
    }

    pub fn get_songs_by_ids(&self, song_ids: &[String]) -> Result<Vec<SongListItem>, String> {
        if song_ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = (0..song_ids.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");

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
                custom_start_ms,
                play_count,
                date_added
            FROM songs
            WHERE id IN ({placeholders})
            "
        );

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("failed to prepare songs-by-ids query: {error}"))?;

        let params: Vec<&dyn rusqlite::ToSql> = song_ids
            .iter()
            .map(|song_id| song_id as &dyn rusqlite::ToSql)
            .collect();

        let rows = statement
            .query_map(params.as_slice(), |row| {
                Ok(SongListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                    artwork_path: row.get(5)?,
                    file_path: row.get(6)?,
                    custom_start_ms: row.get(7)?,
                    play_count: row.get(8)?,
                    date_added: row.get(9)?,
                })
            })
            .map_err(|error| format!("failed to fetch songs by ids: {error}"))?;

        let mut by_id = HashMap::new();
        for row in rows {
            let song = row.map_err(|error| format!("failed to decode song row: {error}"))?;
            by_id.insert(song.id.clone(), song);
        }

        let mut seen = HashSet::new();
        let mut ordered = Vec::new();
        for song_id in song_ids {
            if !seen.insert(song_id.clone()) {
                continue;
            }
            if let Some(song) = by_id.remove(song_id) {
                ordered.push(song);
            }
        }

        Ok(ordered)
    }

    pub fn get_albums(
        &self,
        limit: u32,
        offset: u32,
        sort: &str,
        order: &str,
    ) -> Result<Vec<AlbumListItem>, String> {
        let sort_column = match sort {
            "artist" => "album_artist COLLATE NOCASE",
            "year" => "COALESCE(year, 0)",
            "date_added" => "date_added",
            _ => "album COLLATE NOCASE",
        };

        let sort_order = if order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };

        let query = format!(
            "
            SELECT
                album,
                COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist') AS album_artist,
                COUNT(*) AS song_count,
                COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                MAX(artwork_path) AS artwork_path,
                MAX(year) AS year,
                MIN(date_added) AS date_added
            FROM songs
            GROUP BY
                album,
                COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist')
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
            .map_err(|error| format!("failed to prepare albums query: {error}"))?;

        let rows = statement
            .query_map(params![limit, offset], |row| {
                Ok(AlbumListItem {
                    album: row.get(0)?,
                    album_artist: row.get(1)?,
                    song_count: row.get(2)?,
                    total_duration_ms: row.get(3)?,
                    artwork_path: row.get(4)?,
                    year: row.get(5)?,
                    date_added: row.get(6)?,
                })
            })
            .map_err(|error| format!("failed to query albums: {error}"))?;

        let mut albums = Vec::new();
        for row in rows {
            albums.push(row.map_err(|error| format!("failed to decode album row: {error}"))?);
        }

        Ok(albums)
    }

    pub fn get_album_tracks(&self, album: &str, album_artist: &str) -> Result<Vec<SongListItem>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT
                    id,
                    title,
                    artist,
                    album,
                    duration_ms,
                    artwork_path,
                    file_path,
                    custom_start_ms,
                    play_count,
                    date_added
                FROM songs
                WHERE album = ?1
                  AND COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist') = ?2
                ORDER BY
                    disc_number ASC,
                    COALESCE(track_number, 2147483647) ASC,
                    title COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare album tracks query: {error}"))?;

        let rows = statement
            .query_map(params![album, album_artist], |row| {
                Ok(SongListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                    artwork_path: row.get(5)?,
                    file_path: row.get(6)?,
                    custom_start_ms: row.get(7)?,
                    play_count: row.get(8)?,
                    date_added: row.get(9)?,
                })
            })
            .map_err(|error| format!("failed to query album tracks: {error}"))?;

        let mut tracks = Vec::new();
        for row in rows {
            tracks.push(row.map_err(|error| format!("failed to decode album track: {error}"))?);
        }

        Ok(tracks)
    }

    pub fn get_artists(
        &self,
        limit: u32,
        offset: u32,
        sort: &str,
        order: &str,
    ) -> Result<Vec<ArtistListItem>, String> {
        let sort_column = match sort {
            "play_count" => "play_count",
            _ => "artist COLLATE NOCASE",
        };

        let sort_order = if order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };

        let query = format!(
            "
            SELECT
                COALESCE(NULLIF(artist, ''), 'Unknown Artist') AS artist,
                COUNT(*) AS song_count,
                COUNT(DISTINCT album) AS album_count,
                COALESCE(SUM(play_count), 0) AS play_count,
                MAX(artwork_path) AS artwork_path
            FROM songs
            GROUP BY COALESCE(NULLIF(artist, ''), 'Unknown Artist')
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
            .map_err(|error| format!("failed to prepare artists query: {error}"))?;

        let rows = statement
            .query_map(params![limit, offset], |row| {
                Ok(ArtistListItem {
                    artist: row.get(0)?,
                    song_count: row.get(1)?,
                    album_count: row.get(2)?,
                    play_count: row.get(3)?,
                    artwork_path: row.get(4)?,
                })
            })
            .map_err(|error| format!("failed to query artists: {error}"))?;

        let mut artists = Vec::new();
        for row in rows {
            artists.push(row.map_err(|error| format!("failed to decode artist row: {error}"))?);
        }

        Ok(artists)
    }

    pub fn get_artist_albums(&self, artist: &str) -> Result<Vec<AlbumListItem>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT
                    album,
                    COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist') AS album_artist,
                    COUNT(*) AS song_count,
                    COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                    MAX(artwork_path) AS artwork_path,
                    MAX(year) AS year,
                    MIN(date_added) AS date_added
                FROM songs
                WHERE COALESCE(NULLIF(artist, ''), 'Unknown Artist') = ?1
                GROUP BY
                    album,
                    COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist')
                ORDER BY album COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare artist albums query: {error}"))?;

        let rows = statement
            .query_map(params![artist], |row| {
                Ok(AlbumListItem {
                    album: row.get(0)?,
                    album_artist: row.get(1)?,
                    song_count: row.get(2)?,
                    total_duration_ms: row.get(3)?,
                    artwork_path: row.get(4)?,
                    year: row.get(5)?,
                    date_added: row.get(6)?,
                })
            })
            .map_err(|error| format!("failed to query artist albums: {error}"))?;

        let mut albums = Vec::new();
        for row in rows {
            albums.push(row.map_err(|error| format!("failed to decode artist album row: {error}"))?);
        }

        Ok(albums)
    }

    pub fn search_library(&self, query: &str, limit: u32) -> Result<LibrarySearchResult, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(LibrarySearchResult {
                songs: Vec::new(),
                albums: Vec::new(),
                artists: Vec::new(),
            });
        }

        let fts_query = match build_fts_query(trimmed) {
            Some(value) => value,
            None => {
                return Ok(LibrarySearchResult {
                    songs: Vec::new(),
                    albums: Vec::new(),
                    artists: Vec::new(),
                });
            }
        };

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut song_statement = connection
            .prepare(
                "
                SELECT
                    s.id,
                    s.title,
                    s.artist,
                    s.album,
                    s.duration_ms,
                    s.artwork_path,
                    s.file_path,
                    s.custom_start_ms,
                    s.play_count,
                    s.date_added
                FROM songs_fts
                JOIN songs s ON s.rowid = songs_fts.rowid
                WHERE songs_fts MATCH ?1
                ORDER BY bm25(songs_fts), s.title COLLATE NOCASE ASC
                LIMIT ?2
                ",
            )
            .map_err(|error| format!("failed to prepare search songs query: {error}"))?;

        let song_rows = song_statement
            .query_map(params![fts_query, limit], |row| {
                Ok(SongListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                    artwork_path: row.get(5)?,
                    file_path: row.get(6)?,
                    custom_start_ms: row.get(7)?,
                    play_count: row.get(8)?,
                    date_added: row.get(9)?,
                })
            })
            .map_err(|error| format!("failed to execute songs search query: {error}"))?;

        let mut songs = Vec::new();
        for row in song_rows {
            songs.push(row.map_err(|error| format!("failed to decode songs search row: {error}"))?);
        }

        let like_pattern = format!("%{}%", escape_like_pattern(trimmed));

        let mut album_statement = connection
            .prepare(
                "
                SELECT
                    album,
                    COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist') AS album_artist,
                    COUNT(*) AS song_count,
                    COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                    MAX(artwork_path) AS artwork_path,
                    MAX(year) AS year,
                    MIN(date_added) AS date_added
                FROM songs
                WHERE album LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                GROUP BY
                    album,
                    COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist')
                ORDER BY song_count DESC, album COLLATE NOCASE ASC
                LIMIT ?2
                ",
            )
            .map_err(|error| format!("failed to prepare albums search query: {error}"))?;

        let album_rows = album_statement
            .query_map(params![like_pattern, limit], |row| {
                Ok(AlbumListItem {
                    album: row.get(0)?,
                    album_artist: row.get(1)?,
                    song_count: row.get(2)?,
                    total_duration_ms: row.get(3)?,
                    artwork_path: row.get(4)?,
                    year: row.get(5)?,
                    date_added: row.get(6)?,
                })
            })
            .map_err(|error| format!("failed to execute albums search query: {error}"))?;

        let mut albums = Vec::new();
        for row in album_rows {
            albums.push(row.map_err(|error| format!("failed to decode album search row: {error}"))?);
        }

        let mut artist_statement = connection
            .prepare(
                "
                SELECT
                    COALESCE(NULLIF(artist, ''), 'Unknown Artist') AS artist,
                    COUNT(*) AS song_count,
                    COUNT(DISTINCT album) AS album_count,
                    COALESCE(SUM(play_count), 0) AS play_count,
                    MAX(artwork_path) AS artwork_path
                FROM songs
                WHERE artist LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                GROUP BY COALESCE(NULLIF(artist, ''), 'Unknown Artist')
                ORDER BY song_count DESC, artist COLLATE NOCASE ASC
                LIMIT ?2
                ",
            )
            .map_err(|error| format!("failed to prepare artists search query: {error}"))?;

        let artist_rows = artist_statement
            .query_map(params![like_pattern, limit], |row| {
                Ok(ArtistListItem {
                    artist: row.get(0)?,
                    song_count: row.get(1)?,
                    album_count: row.get(2)?,
                    play_count: row.get(3)?,
                    artwork_path: row.get(4)?,
                })
            })
            .map_err(|error| format!("failed to execute artists search query: {error}"))?;

        let mut artists = Vec::new();
        for row in artist_rows {
            artists.push(row.map_err(|error| format!("failed to decode artist search row: {error}"))?);
        }

        Ok(LibrarySearchResult {
            songs,
            albums,
            artists,
        })
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

    pub fn get_song_match_candidates(&self) -> Result<Vec<SongMatchCandidate>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT id, file_path, title, artist, duration_ms
                FROM songs
                ",
            )
            .map_err(|error| format!("failed to prepare match candidates query: {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok(SongMatchCandidate {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    duration_ms: row.get(4)?,
                })
            })
            .map_err(|error| format!("failed to read match candidates: {error}"))?;

        let mut songs = Vec::new();
        for row in rows {
            songs.push(row.map_err(|error| format!("failed to decode match candidate row: {error}"))?);
        }

        Ok(songs)
    }

    pub fn apply_itunes_import(
        &self,
        song_updates: &[ItunesSongDbUpdate],
        import_play_counts: bool,
        import_ratings: bool,
        import_comments: bool,
        playlist_imports: &[PlaylistImportData],
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start iTunes import transaction: {error}"))?;

        {
            let mut update_statement = transaction
                .prepare(
                    "
                    UPDATE songs
                    SET
                        play_count = CASE
                            WHEN ?2 = 1 THEN COALESCE(?3, play_count)
                            ELSE play_count
                        END,
                        skip_count = CASE
                            WHEN ?2 = 1 THEN COALESCE(?4, skip_count)
                            ELSE skip_count
                        END,
                        rating = CASE
                            WHEN ?5 = 1 THEN COALESCE(?6, rating)
                            ELSE rating
                        END,
                        comment = CASE
                            WHEN ?7 = 1 THEN COALESCE(?8, comment)
                            ELSE comment
                        END,
                        date_added = COALESCE(?9, date_added),
                        last_played_at = COALESCE(?10, last_played_at),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?1
                    ",
                )
                .map_err(|error| format!("failed to prepare iTunes song update statement: {error}"))?;

            for update in song_updates {
                update_statement
                    .execute(params![
                        update.song_id,
                        bool_to_i64(import_play_counts),
                        update.play_count,
                        update.skip_count,
                        bool_to_i64(import_ratings),
                        update.rating,
                        bool_to_i64(import_comments),
                        update.comment,
                        update.date_added,
                        update.last_played_at,
                    ])
                    .map_err(|error| format!("failed to apply iTunes song update: {error}"))?;
            }
        }

        if !playlist_imports.is_empty() {
            let mut select_playlist = transaction
                .prepare("SELECT id FROM playlists WHERE name = ?1 AND is_folder = 0 LIMIT 1")
                .map_err(|error| format!("failed to prepare playlist lookup statement: {error}"))?;
            let mut touch_playlist = transaction
                .prepare("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1")
                .map_err(|error| format!("failed to prepare playlist touch statement: {error}"))?;
            let mut insert_playlist = transaction
                .prepare("INSERT INTO playlists (id, name, is_folder) VALUES (?1, ?2, 0)")
                .map_err(|error| format!("failed to prepare playlist insert statement: {error}"))?;
            let mut delete_tracks = transaction
                .prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?1")
                .map_err(|error| format!("failed to prepare playlist cleanup statement: {error}"))?;
            let mut insert_track = transaction
                .prepare(
                    "
                    INSERT INTO playlist_tracks (id, playlist_id, song_id, position)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                )
                .map_err(|error| format!("failed to prepare playlist track insert statement: {error}"))?;

            for playlist in playlist_imports {
                if playlist.name.trim().is_empty() {
                    continue;
                }

                let existing_id = select_playlist
                    .query_row(params![playlist.name], |row| row.get::<_, String>(0))
                    .optional()
                    .map_err(|error| format!("failed to query existing playlist: {error}"))?;

                let playlist_id = if let Some(existing_id) = existing_id {
                    touch_playlist
                        .execute(params![existing_id])
                        .map_err(|error| format!("failed to update playlist timestamp: {error}"))?;
                    existing_id
                } else {
                    let created_id = Uuid::new_v4().to_string();
                    insert_playlist
                        .execute(params![created_id, playlist.name])
                        .map_err(|error| format!("failed to create playlist: {error}"))?;
                    created_id
                };

                delete_tracks
                    .execute(params![playlist_id])
                    .map_err(|error| format!("failed to clear playlist tracks: {error}"))?;

                let mut seen_song_ids = HashSet::new();
                let mut position: i64 = 0;
                for song_id in &playlist.song_ids {
                    if !seen_song_ids.insert(song_id.clone()) {
                        continue;
                    }

                    insert_track
                        .execute(params![Uuid::new_v4().to_string(), playlist_id, song_id, position])
                        .map_err(|error| format!("failed to insert playlist track: {error}"))?;
                    position += 1;
                }
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit iTunes import transaction: {error}"))
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

fn bool_to_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn build_fts_query(query: &str) -> Option<String> {
    let mut terms = Vec::new();
    for raw_term in query.split_whitespace() {
        let normalized = raw_term
            .chars()
            .filter(|character| {
                character.is_ascii_alphanumeric() || *character == '_' || *character == '-'
            })
            .collect::<String>();

        if !normalized.is_empty() {
            terms.push(format!("{normalized}*"));
        }
    }

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn escape_like_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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

    let migration_2_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 2)",
        [],
        |row| row.get(0),
    )?;

    if !migration_2_applied {
        connection.execute_batch(MIGRATION_0002)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (2)", [])?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Database, build_fts_query, run_migrations};
    use rusqlite::{Connection, params};
    use std::path::PathBuf;
    use std::sync::Mutex;

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
    }

    #[test]
    fn builds_expected_fts_query() {
        assert_eq!(build_fts_query("hello world"), Some(String::from("hello* AND world*")));
        assert_eq!(build_fts_query("hello!!!"), Some(String::from("hello*")));
        assert_eq!(build_fts_query("   "), None);
    }

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
            artwork_dir: PathBuf::from("/tmp"),
        };

        let songs_by_play_count = db
            .get_songs(10, 0, "play_count", "desc")
            .expect("failed to sort songs by play count");
        assert_eq!(songs_by_play_count[0].id, "song-2");

        let albums = db.get_albums(10, 0, "name", "asc").expect("failed to query albums");
        assert_eq!(albums.len(), 2);

        let artists = db
            .get_artists(10, 0, "name", "asc")
            .expect("failed to query artists");
        assert_eq!(artists.len(), 2);
    }
}
