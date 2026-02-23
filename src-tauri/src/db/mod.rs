use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MIGRATION_0001: &str = include_str!("../../migrations/0001_phase1.sql");
const MIGRATION_0002: &str = include_str!("../../migrations/0002_phase2_itunes.sql");
const MIGRATION_0003: &str = include_str!("../../migrations/0003_phase3_playlists.sql");
const MIGRATION_0004: &str = include_str!("../../migrations/0004_itunes_playlist_hierarchy.sql");

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
    pub external_id: String,
    pub parent_external_id: Option<String>,
    pub name: String,
    pub is_folder: bool,
    pub sort_order: i64,
    pub song_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistNode {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub is_folder: bool,
    pub sort_order: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistTrackItem {
    pub playlist_id: String,
    pub position: i64,
    pub song: SongListItem,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistMutationResult {
    pub affected: i64,
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

    pub fn playlist_list(&self) -> Result<Vec<PlaylistNode>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT
                    id,
                    name,
                    parent_id,
                    is_folder,
                    sort_order,
                    created_at,
                    updated_at
                FROM playlists
                ORDER BY
                    CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END ASC,
                    parent_id COLLATE NOCASE ASC,
                    sort_order ASC,
                    name COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare playlists query: {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok(PlaylistNode {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    is_folder: row.get::<_, i64>(3)? == 1,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|error| format!("failed to query playlists: {error}"))?;

        let mut playlists = Vec::new();
        for row in rows {
            playlists.push(row.map_err(|error| format!("failed to decode playlist row: {error}"))?);
        }

        Ok(playlists)
    }

    pub fn playlist_create(
        &self,
        name: &str,
        parent_id: Option<&str>,
        is_folder: bool,
    ) -> Result<PlaylistNode, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist create transaction: {error}"))?;

        ensure_valid_parent_folder(&transaction, parent_id)?;
        let requested_name = normalize_playlist_name(name, is_folder);
        let resolved_name = resolve_unique_playlist_name(&transaction, parent_id, &requested_name, None)?;
        let sort_order = next_playlist_sort_order(&transaction, parent_id)?;
        let playlist_id = Uuid::new_v4().to_string();

        transaction
            .execute(
                "
                INSERT INTO playlists (id, name, parent_id, is_folder, sort_order)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    playlist_id,
                    resolved_name,
                    parent_id,
                    bool_to_i64(is_folder),
                    sort_order
                ],
            )
            .map_err(|error| format!("failed to create playlist: {error}"))?;

        let created = get_playlist_node_with_tx(&transaction, &playlist_id)?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist create transaction: {error}"))?;

        Ok(created)
    }

    pub fn playlist_rename(&self, playlist_id: &str, name: &str) -> Result<PlaylistNode, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist rename transaction: {error}"))?;

        let current = get_playlist_node_with_tx(&transaction, playlist_id)?;
        let requested_name = normalize_playlist_name(name, current.is_folder);
        let resolved_name = resolve_unique_playlist_name(
            &transaction,
            current.parent_id.as_deref(),
            &requested_name,
            Some(playlist_id),
        )?;

        transaction
            .execute(
                "UPDATE playlists SET name = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![resolved_name, playlist_id],
            )
            .map_err(|error| format!("failed to rename playlist: {error}"))?;

        let updated = get_playlist_node_with_tx(&transaction, playlist_id)?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist rename transaction: {error}"))?;

        Ok(updated)
    }

    pub fn playlist_delete(&self, playlist_id: &str) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist delete transaction: {error}"))?;

        let current = get_playlist_node_with_tx(&transaction, playlist_id)?;
        let affected = transaction
            .execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
            .map_err(|error| format!("failed to delete playlist: {error}"))?;

        if affected == 0 {
            return Err(String::from("playlist not found"));
        }

        let sibling_ids = fetch_child_playlist_ids(&transaction, current.parent_id.as_deref())?;
        persist_child_playlist_order(&transaction, current.parent_id.as_deref(), &sibling_ids)?;

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist delete transaction: {error}"))?;
        Ok(())
    }

    pub fn playlist_duplicate(&self, playlist_id: &str) -> Result<PlaylistNode, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist duplicate transaction: {error}"))?;

        let current = get_playlist_node_with_tx(&transaction, playlist_id)?;
        if current.is_folder {
            return Err(String::from("folders cannot be duplicated"));
        }

        let resolved_name = resolve_unique_playlist_name(
            &transaction,
            current.parent_id.as_deref(),
            &current.name,
            None,
        )?;
        let duplicated_id = Uuid::new_v4().to_string();
        let sort_order = next_playlist_sort_order(&transaction, current.parent_id.as_deref())?;

        transaction
            .execute(
                "
                INSERT INTO playlists (id, name, parent_id, is_folder, sort_order)
                VALUES (?1, ?2, ?3, 0, ?4)
                ",
                params![
                    duplicated_id,
                    resolved_name,
                    current.parent_id.as_deref(),
                    sort_order
                ],
            )
            .map_err(|error| format!("failed to duplicate playlist: {error}"))?;

        let source_song_ids = fetch_playlist_track_song_ids(&transaction, playlist_id)?;
        {
            let mut insert_statement = transaction
                .prepare(
                    "
                    INSERT INTO playlist_tracks (id, playlist_id, song_id, position)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                )
                .map_err(|error| format!("failed to prepare playlist track duplicate statement: {error}"))?;

            for (position, song_id) in source_song_ids.iter().enumerate() {
                insert_statement
                    .execute(params![
                        Uuid::new_v4().to_string(),
                        duplicated_id,
                        song_id,
                        position as i64
                    ])
                    .map_err(|error| format!("failed to duplicate playlist track: {error}"))?;
            }
        }

        let duplicated = get_playlist_node_with_tx(&transaction, &duplicated_id)?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist duplicate transaction: {error}"))?;

        Ok(duplicated)
    }

    pub fn playlist_move(
        &self,
        playlist_id: &str,
        new_parent_id: Option<&str>,
        new_index: i64,
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist move transaction: {error}"))?;

        let current = get_playlist_node_with_tx(&transaction, playlist_id)?;
        if let Some(target_parent_id) = new_parent_id {
            if target_parent_id == playlist_id {
                return Err(String::from("cannot move a playlist into itself"));
            }
            ensure_valid_parent_folder(&transaction, Some(target_parent_id))?;
            if is_playlist_descendant(&transaction, playlist_id, target_parent_id)? {
                return Err(String::from("cannot move a playlist into one of its descendants"));
            }
        }

        let old_parent = current.parent_id.clone();
        let same_parent = old_parent.as_deref() == new_parent_id;

        let mut old_sibling_ids = fetch_child_playlist_ids(&transaction, old_parent.as_deref())?;
        old_sibling_ids.retain(|id| id != playlist_id);

        let mut target_sibling_ids = if same_parent {
            old_sibling_ids.clone()
        } else {
            fetch_child_playlist_ids(&transaction, new_parent_id)?
        };
        target_sibling_ids.retain(|id| id != playlist_id);

        let bounded_index = clamp_index(new_index, target_sibling_ids.len());
        target_sibling_ids.insert(bounded_index, playlist_id.to_string());

        if same_parent {
            persist_child_playlist_order(&transaction, old_parent.as_deref(), &target_sibling_ids)?;
        } else {
            persist_child_playlist_order(&transaction, old_parent.as_deref(), &old_sibling_ids)?;
            persist_child_playlist_order(&transaction, new_parent_id, &target_sibling_ids)?;
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist move transaction: {error}"))?;

        Ok(())
    }

    pub fn playlist_get_tracks(&self, playlist_id: &str) -> Result<Vec<PlaylistTrackItem>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let playlist = get_playlist_node_with_connection(&connection, playlist_id)?;
        if playlist.is_folder {
            return Err(String::from("folders cannot contain tracks"));
        }

        let mut statement = connection
            .prepare(
                "
                SELECT
                    pt.playlist_id,
                    pt.position,
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
                FROM playlist_tracks pt
                INNER JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = ?1
                ORDER BY pt.position ASC, pt.added_at ASC
                ",
            )
            .map_err(|error| format!("failed to prepare playlist tracks query: {error}"))?;

        let rows = statement
            .query_map(params![playlist_id], |row| {
                Ok(PlaylistTrackItem {
                    playlist_id: row.get(0)?,
                    position: row.get(1)?,
                    song: SongListItem {
                        id: row.get(2)?,
                        title: row.get(3)?,
                        artist: row.get(4)?,
                        album: row.get(5)?,
                        duration_ms: row.get(6)?,
                        artwork_path: row.get(7)?,
                        file_path: row.get(8)?,
                        custom_start_ms: row.get(9)?,
                        play_count: row.get(10)?,
                        date_added: row.get(11)?,
                    },
                })
            })
            .map_err(|error| format!("failed to query playlist tracks: {error}"))?;

        let mut tracks = Vec::new();
        for row in rows {
            tracks.push(row.map_err(|error| format!("failed to decode playlist track row: {error}"))?);
        }

        Ok(tracks)
    }

    pub fn playlist_add_songs(
        &self,
        playlist_id: &str,
        song_ids: &[String],
        insert_index: Option<i64>,
    ) -> Result<PlaylistMutationResult, String> {
        if song_ids.is_empty() {
            return Ok(PlaylistMutationResult { affected: 0 });
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist add songs transaction: {error}"))?;

        ensure_playlist_accepts_tracks(&transaction, playlist_id)?;

        let mut seen_input = HashSet::<String>::new();
        let mut deduped = Vec::<String>::new();
        for song_id in song_ids {
            if seen_input.insert(song_id.clone()) {
                deduped.push(song_id.clone());
            }
        }

        let mut candidates = Vec::<String>::new();
        {
            let mut existing_song_query = transaction
                .prepare("SELECT 1 FROM songs WHERE id = ?1 LIMIT 1")
                .map_err(|error| format!("failed to prepare song existence query: {error}"))?;
            let mut existing_in_playlist_query = transaction
                .prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND song_id = ?2 LIMIT 1")
                .map_err(|error| format!("failed to prepare playlist duplicate query: {error}"))?;

            for song_id in &deduped {
                let song_exists = existing_song_query
                    .query_row(params![song_id], |_| Ok(()))
                    .optional()
                    .map_err(|error| format!("failed to validate song id {song_id}: {error}"))?
                    .is_some();
                if !song_exists {
                    continue;
                }

                let already_in_playlist = existing_in_playlist_query
                    .query_row(params![playlist_id, song_id], |_| Ok(()))
                    .optional()
                    .map_err(|error| format!("failed to validate playlist duplicate for song {song_id}: {error}"))?
                    .is_some();
                if already_in_playlist {
                    continue;
                }

                candidates.push(song_id.clone());
            }
        }

        if candidates.is_empty() {
            transaction
                .commit()
                .map_err(|error| format!("failed to commit empty playlist add transaction: {error}"))?;
            return Ok(PlaylistMutationResult { affected: 0 });
        }

        let current_count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("failed to count playlist tracks: {error}"))?;

        let bounded_insert_index = insert_index
            .unwrap_or(current_count)
            .clamp(0, current_count) as usize;

        transaction
            .execute(
                "
                UPDATE playlist_tracks
                SET position = position + ?2
                WHERE playlist_id = ?1 AND position >= ?3
                ",
                params![playlist_id, candidates.len() as i64, bounded_insert_index as i64],
            )
            .map_err(|error| format!("failed to shift playlist tracks for insert: {error}"))?;

        {
            let mut insert_statement = transaction
                .prepare(
                    "
                    INSERT INTO playlist_tracks (id, playlist_id, song_id, position)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                )
                .map_err(|error| format!("failed to prepare playlist track insert statement: {error}"))?;

            for (offset, song_id) in candidates.iter().enumerate() {
                insert_statement
                    .execute(params![
                        Uuid::new_v4().to_string(),
                        playlist_id,
                        song_id,
                        bounded_insert_index as i64 + offset as i64
                    ])
                    .map_err(|error| format!("failed to add song to playlist: {error}"))?;
            }
        }

        rebalance_playlist_track_positions(&transaction, playlist_id)?;

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist add songs transaction: {error}"))?;

        Ok(PlaylistMutationResult {
            affected: candidates.len() as i64,
        })
    }

    pub fn playlist_remove_songs(
        &self,
        playlist_id: &str,
        song_ids: &[String],
    ) -> Result<PlaylistMutationResult, String> {
        if song_ids.is_empty() {
            return Ok(PlaylistMutationResult { affected: 0 });
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist remove songs transaction: {error}"))?;

        ensure_playlist_accepts_tracks(&transaction, playlist_id)?;

        let mut seen = HashSet::<String>::new();
        let mut deduped = Vec::<String>::new();
        for song_id in song_ids {
            if seen.insert(song_id.clone()) {
                deduped.push(song_id.clone());
            }
        }

        let mut affected: i64 = 0;
        {
            let mut delete_statement = transaction
                .prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND song_id = ?2")
                .map_err(|error| format!("failed to prepare playlist remove statement: {error}"))?;

            for song_id in &deduped {
                let removed = delete_statement
                    .execute(params![playlist_id, song_id])
                    .map_err(|error| format!("failed to remove song from playlist: {error}"))?;
                affected += removed as i64;
            }
        }

        if affected > 0 {
            rebalance_playlist_track_positions(&transaction, playlist_id)?;
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist remove songs transaction: {error}"))?;

        Ok(PlaylistMutationResult { affected })
    }

    pub fn playlist_reorder_tracks(
        &self,
        playlist_id: &str,
        ordered_song_ids: &[String],
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start playlist reorder transaction: {error}"))?;

        ensure_playlist_accepts_tracks(&transaction, playlist_id)?;

        let current_song_ids = fetch_playlist_track_song_ids(&transaction, playlist_id)?;
        if current_song_ids.is_empty() {
            transaction
                .commit()
                .map_err(|error| format!("failed to commit empty playlist reorder transaction: {error}"))?;
            return Ok(());
        }

        let existing_set: HashSet<String> = current_song_ids.iter().cloned().collect();
        let mut seen = HashSet::<String>::new();
        let mut reordered = Vec::<String>::new();

        for song_id in ordered_song_ids {
            if existing_set.contains(song_id) && seen.insert(song_id.clone()) {
                reordered.push(song_id.clone());
            }
        }

        for song_id in current_song_ids {
            if seen.insert(song_id.clone()) {
                reordered.push(song_id);
            }
        }

        {
            let mut update_statement = transaction
                .prepare(
                    "
                    UPDATE playlist_tracks
                    SET position = ?3
                    WHERE playlist_id = ?1 AND song_id = ?2
                    ",
                )
                .map_err(|error| format!("failed to prepare playlist reorder update statement: {error}"))?;

            for (position, song_id) in reordered.iter().enumerate() {
                update_statement
                    .execute(params![playlist_id, song_id, position as i64])
                    .map_err(|error| format!("failed to update playlist track position: {error}"))?;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist reorder transaction: {error}"))?;

        Ok(())
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
            let mut pending = playlist_imports.to_vec();
            pending.sort_by(|left, right| left.sort_order.cmp(&right.sort_order));

            let mut external_to_local = HashMap::<String, String>::new();

            let mut remaining = pending;
            let mut iterations: usize = 0;
            let max_iterations = remaining.len().saturating_add(1);

            while !remaining.is_empty() && iterations < max_iterations {
                iterations += 1;
                let mut next_remaining = Vec::<PlaylistImportData>::new();
                let mut progressed = false;

                for playlist in remaining {
                    let resolved_parent_id = match &playlist.parent_external_id {
                        Some(parent_external_id) => {
                            if let Some(parent_id) = external_to_local.get(parent_external_id) {
                                Some(parent_id.clone())
                            } else {
                                next_remaining.push(playlist);
                                continue;
                            }
                        }
                        None => None,
                    };

                    apply_itunes_playlist_import_entry(
                        &transaction,
                        &playlist,
                        resolved_parent_id.as_deref(),
                        &mut external_to_local,
                    )?;
                    progressed = true;
                }

                if !progressed {
                    remaining = next_remaining;
                    break;
                }

                remaining = next_remaining;
            }

            for playlist in remaining {
                apply_itunes_playlist_import_entry(
                    &transaction,
                    &playlist,
                    None,
                    &mut external_to_local,
                )?;
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

fn apply_itunes_playlist_import_entry(
    transaction: &Transaction<'_>,
    playlist: &PlaylistImportData,
    resolved_parent_id: Option<&str>,
    external_to_local: &mut HashMap<String, String>,
) -> Result<(), String> {
    if playlist.name.trim().is_empty() || playlist.external_id.trim().is_empty() {
        return Ok(());
    }

    let existing_by_source = transaction
        .query_row(
            "
            SELECT id
            FROM playlists
            WHERE source_type = 'itunes' AND source_external_id = ?1
            LIMIT 1
            ",
            params![playlist.external_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to query existing iTunes playlist: {error}"))?;

    let existing_id = if let Some(id) = existing_by_source {
        Some(id)
    } else {
        transaction
            .query_row(
                "
                SELECT id
                FROM playlists
                WHERE name = ?1
                  AND is_folder = ?2
                  AND source_type IS NULL
                LIMIT 1
                ",
                params![playlist.name, bool_to_i64(playlist.is_folder)],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to query fallback playlist by name: {error}"))?
    };

    let playlist_id = if let Some(existing_id) = existing_id {
        transaction
            .execute(
                "
                UPDATE playlists
                SET
                    name = ?1,
                    parent_id = ?2,
                    is_folder = ?3,
                    sort_order = ?4,
                    source_type = 'itunes',
                    source_external_id = ?5,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?6
                ",
                params![
                    playlist.name,
                    resolved_parent_id,
                    bool_to_i64(playlist.is_folder),
                    playlist.sort_order,
                    playlist.external_id,
                    existing_id
                ],
            )
            .map_err(|error| format!("failed to update iTunes playlist: {error}"))?;
        existing_id
    } else {
        let created_id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "
                INSERT INTO playlists (
                    id,
                    name,
                    parent_id,
                    is_folder,
                    sort_order,
                    source_type,
                    source_external_id
                ) VALUES (?1, ?2, ?3, ?4, ?5, 'itunes', ?6)
                ",
                params![
                    created_id,
                    playlist.name,
                    resolved_parent_id,
                    bool_to_i64(playlist.is_folder),
                    playlist.sort_order,
                    playlist.external_id
                ],
            )
            .map_err(|error| format!("failed to create iTunes playlist: {error}"))?;
        created_id
    };

    transaction
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| format!("failed to clear iTunes playlist tracks: {error}"))?;

    if !playlist.is_folder {
        let mut seen_song_ids = HashSet::new();
        let mut position: i64 = 0;
        for song_id in &playlist.song_ids {
            if !seen_song_ids.insert(song_id.clone()) {
                continue;
            }

            transaction
                .execute(
                    "
                    INSERT INTO playlist_tracks (id, playlist_id, song_id, position)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                    params![Uuid::new_v4().to_string(), playlist_id, song_id, position],
                )
                .map_err(|error| format!("failed to insert iTunes playlist track: {error}"))?;
            position += 1;
        }
    }

    external_to_local.insert(playlist.external_id.clone(), playlist_id);
    Ok(())
}

fn normalize_playlist_name(name: &str, is_folder: bool) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        if is_folder {
            String::from("New Folder")
        } else {
            String::from("New Playlist")
        }
    } else {
        trimmed.to_string()
    }
}

fn get_playlist_node_with_connection(
    connection: &Connection,
    playlist_id: &str,
) -> Result<PlaylistNode, String> {
    connection
        .query_row(
            "
            SELECT
                id,
                name,
                parent_id,
                is_folder,
                sort_order,
                created_at,
                updated_at
            FROM playlists
            WHERE id = ?1
            ",
            params![playlist_id],
            |row| {
                Ok(PlaylistNode {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    is_folder: row.get::<_, i64>(3)? == 1,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| format!("failed to load playlist {playlist_id}: {error}"))
}

fn get_playlist_node_with_tx(transaction: &Transaction<'_>, playlist_id: &str) -> Result<PlaylistNode, String> {
    transaction
        .query_row(
            "
            SELECT
                id,
                name,
                parent_id,
                is_folder,
                sort_order,
                created_at,
                updated_at
            FROM playlists
            WHERE id = ?1
            ",
            params![playlist_id],
            |row| {
                Ok(PlaylistNode {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    is_folder: row.get::<_, i64>(3)? == 1,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|error| format!("failed to load playlist {playlist_id}: {error}"))
}

fn ensure_valid_parent_folder(transaction: &Transaction<'_>, parent_id: Option<&str>) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };

    let parent = get_playlist_node_with_tx(transaction, parent_id)?;
    if !parent.is_folder {
        return Err(String::from("parent playlist must be a folder"));
    }

    Ok(())
}

fn ensure_playlist_accepts_tracks(transaction: &Transaction<'_>, playlist_id: &str) -> Result<(), String> {
    let playlist = get_playlist_node_with_tx(transaction, playlist_id)?;
    if playlist.is_folder {
        return Err(String::from("folders cannot contain tracks"));
    }
    Ok(())
}

fn resolve_unique_playlist_name(
    transaction: &Transaction<'_>,
    parent_id: Option<&str>,
    desired_name: &str,
    exclude_id: Option<&str>,
) -> Result<String, String> {
    let mut statement = transaction
        .prepare(
            "
            SELECT id, name
            FROM playlists
            WHERE ((parent_id IS NULL AND ?1 IS NULL) OR parent_id = ?1)
            ",
        )
        .map_err(|error| format!("failed to prepare sibling name query: {error}"))?;

    let rows = statement
        .query_map(params![parent_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("failed to query sibling names: {error}"))?;

    let mut existing_names = HashSet::<String>::new();
    for row in rows {
        let (sibling_id, sibling_name) =
            row.map_err(|error| format!("failed to decode sibling name row: {error}"))?;
        if exclude_id.is_some() && exclude_id == Some(sibling_id.as_str()) {
            continue;
        }
        existing_names.insert(sibling_name.to_lowercase());
    }

    let mut suffix = 1_i64;
    let base_name = desired_name.trim();
    let mut candidate = base_name.to_string();
    while existing_names.contains(&candidate.to_lowercase()) {
        suffix += 1;
        candidate = format!("{base_name} ({suffix})");
    }

    Ok(candidate)
}

fn next_playlist_sort_order(transaction: &Transaction<'_>, parent_id: Option<&str>) -> Result<i64, String> {
    let max_sort_order: Option<i64> = transaction
        .query_row(
            "
            SELECT MAX(sort_order)
            FROM playlists
            WHERE ((parent_id IS NULL AND ?1 IS NULL) OR parent_id = ?1)
            ",
            params![parent_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to query next playlist sort order: {error}"))?;
    Ok(max_sort_order.unwrap_or(-1) + 1)
}

fn fetch_child_playlist_ids(
    transaction: &Transaction<'_>,
    parent_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut statement = transaction
        .prepare(
            "
            SELECT id
            FROM playlists
            WHERE ((parent_id IS NULL AND ?1 IS NULL) OR parent_id = ?1)
            ORDER BY sort_order ASC, name COLLATE NOCASE ASC
            ",
        )
        .map_err(|error| format!("failed to prepare child playlists query: {error}"))?;

    let rows = statement
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query child playlists: {error}"))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|error| format!("failed to decode child playlist row: {error}"))?);
    }
    Ok(ids)
}

fn persist_child_playlist_order(
    transaction: &Transaction<'_>,
    parent_id: Option<&str>,
    ordered_ids: &[String],
) -> Result<(), String> {
    let mut update_statement = transaction
        .prepare(
            "
            UPDATE playlists
            SET parent_id = ?1, sort_order = ?2, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?3
            ",
        )
        .map_err(|error| format!("failed to prepare playlist sort update statement: {error}"))?;

    for (sort_order, playlist_id) in ordered_ids.iter().enumerate() {
        update_statement
            .execute(params![parent_id, sort_order as i64, playlist_id])
            .map_err(|error| format!("failed to update playlist sort order: {error}"))?;
    }

    Ok(())
}

fn is_playlist_descendant(
    transaction: &Transaction<'_>,
    ancestor_id: &str,
    possible_descendant_id: &str,
) -> Result<bool, String> {
    let mut current_id = Some(possible_descendant_id.to_string());
    while let Some(node_id) = current_id {
        if node_id == ancestor_id {
            return Ok(true);
        }

        current_id = transaction
            .query_row(
                "SELECT parent_id FROM playlists WHERE id = ?1",
                params![node_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| format!("failed to traverse playlist hierarchy: {error}"))?
            .flatten();
    }

    Ok(false)
}

fn clamp_index(index: i64, len: usize) -> usize {
    if index <= 0 {
        0
    } else if index as usize > len {
        len
    } else {
        index as usize
    }
}

fn fetch_playlist_track_song_ids(
    transaction: &Transaction<'_>,
    playlist_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = transaction
        .prepare(
            "
            SELECT song_id
            FROM playlist_tracks
            WHERE playlist_id = ?1
            ORDER BY position ASC, added_at ASC
            ",
        )
        .map_err(|error| format!("failed to prepare playlist track order query: {error}"))?;

    let rows = statement
        .query_map(params![playlist_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query playlist track order: {error}"))?;

    let mut song_ids = Vec::new();
    for row in rows {
        song_ids.push(row.map_err(|error| format!("failed to decode playlist track order row: {error}"))?);
    }
    Ok(song_ids)
}

fn rebalance_playlist_track_positions(
    transaction: &Transaction<'_>,
    playlist_id: &str,
) -> Result<(), String> {
    let song_ids = fetch_playlist_track_song_ids(transaction, playlist_id)?;
    let mut update_statement = transaction
        .prepare(
            "
            UPDATE playlist_tracks
            SET position = ?3
            WHERE playlist_id = ?1 AND song_id = ?2
            ",
        )
        .map_err(|error| format!("failed to prepare playlist position rebalance statement: {error}"))?;

    for (position, song_id) in song_ids.iter().enumerate() {
        update_statement
            .execute(params![playlist_id, song_id, position as i64])
            .map_err(|error| format!("failed to rebalance playlist positions: {error}"))?;
    }
    Ok(())
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

    let migration_3_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 3)",
        [],
        |row| row.get(0),
    )?;

    if !migration_3_applied {
        connection.execute_batch(MIGRATION_0003)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (3)", [])?;
    }

    let migration_4_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 4)",
        [],
        |row| row.get(0),
    )?;

    if !migration_4_applied {
        connection.execute_batch(MIGRATION_0004)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (4)", [])?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Database, build_fts_query, run_migrations};
    use rusqlite::{Connection, params};
    use std::path::PathBuf;
    use std::sync::Mutex;

    fn test_db() -> Database {
        let connection = Connection::open_in_memory().expect("failed to open in-memory db");
        run_migrations(&connection).expect("failed to run migrations");
        Database {
            connection: Mutex::new(connection),
            artwork_dir: PathBuf::from("/tmp"),
        }
    }

    fn seed_song(db: &Database, song_id: &str, title: &str) {
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

        let migration_4_applied: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
                [],
                |row| row.get(0),
            )
            .expect("failed to check migration 4");
        assert_eq!(migration_4_applied, 1);
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

    #[test]
    fn creates_nested_playlists_with_contiguous_sort_order() {
        let db = test_db();

        let root_a = db
            .playlist_create("Root A", None, false)
            .expect("failed to create root playlist");
        let root_b = db
            .playlist_create("Root B", None, true)
            .expect("failed to create root folder");
        let child_a = db
            .playlist_create("Child A", Some(&root_b.id), false)
            .expect("failed to create child playlist");
        let child_b = db
            .playlist_create("Child B", Some(&root_b.id), false)
            .expect("failed to create child playlist");

        assert_eq!(root_a.sort_order, 0);
        assert_eq!(root_b.sort_order, 1);
        assert_eq!(child_a.sort_order, 0);
        assert_eq!(child_b.sort_order, 1);

        db.playlist_delete(&child_a.id)
            .expect("failed to delete child playlist");

        let children_after_delete = db
            .playlist_list()
            .expect("failed to list playlists")
            .into_iter()
            .filter(|node| node.parent_id.as_deref() == Some(root_b.id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(children_after_delete.len(), 1);
        assert_eq!(children_after_delete[0].id, child_b.id);
        assert_eq!(children_after_delete[0].sort_order, 0);
    }

    #[test]
    fn auto_suffixes_duplicate_playlist_names_on_create_and_rename() {
        let db = test_db();

        let first = db
            .playlist_create("Mix", None, false)
            .expect("failed to create first playlist");
        let second = db
            .playlist_create("Mix", None, false)
            .expect("failed to create second playlist");
        let third = db
            .playlist_create("Mix", None, false)
            .expect("failed to create third playlist");

        assert_eq!(first.name, "Mix");
        assert_eq!(second.name, "Mix (2)");
        assert_eq!(third.name, "Mix (3)");

        let renamed = db
            .playlist_rename(&second.id, "Mix")
            .expect("failed to rename playlist");
        assert_eq!(renamed.name, "Mix (2)");
    }

    #[test]
    fn prevents_playlist_move_cycles_and_reorders_siblings() {
        let db = test_db();

        let folder_a = db
            .playlist_create("Folder A", None, true)
            .expect("failed to create folder a");
        let folder_b = db
            .playlist_create("Folder B", Some(&folder_a.id), true)
            .expect("failed to create folder b");
        let playlist = db
            .playlist_create("Playlist", Some(&folder_b.id), false)
            .expect("failed to create playlist");

        let cycle_error = db
            .playlist_move(&folder_a.id, Some(&folder_b.id), 0)
            .expect_err("expected cycle prevention error");
        assert!(cycle_error.contains("descendants"));

        db.playlist_move(&playlist.id, None, 0)
            .expect("failed to move playlist to root");

        let moved = db
            .playlist_list()
            .expect("failed to list playlists")
            .into_iter()
            .find(|node| node.id == playlist.id)
            .expect("failed to find moved playlist");
        assert_eq!(moved.parent_id, None);
        assert_eq!(moved.sort_order, 0);
    }

    #[test]
    fn duplicates_playlist_with_song_order() {
        let db = test_db();
        seed_song(&db, "song-1", "Song 1");
        seed_song(&db, "song-2", "Song 2");

        let playlist = db
            .playlist_create("Roadtrip", None, false)
            .expect("failed to create playlist");
        db.playlist_add_songs(
            &playlist.id,
            &[String::from("song-1"), String::from("song-2")],
            None,
        )
        .expect("failed to add playlist songs");

        let duplicated = db
            .playlist_duplicate(&playlist.id)
            .expect("failed to duplicate playlist");
        assert_eq!(duplicated.name, "Roadtrip (2)");

        let tracks = db
            .playlist_get_tracks(&duplicated.id)
            .expect("failed to get duplicated tracks");
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].song.id, "song-1");
        assert_eq!(tracks[1].song.id, "song-2");
        assert_eq!(tracks[0].position, 0);
        assert_eq!(tracks[1].position, 1);
    }

    #[test]
    fn add_remove_and_reorder_tracks_keep_positions_contiguous() {
        let db = test_db();
        seed_song(&db, "song-1", "Song 1");
        seed_song(&db, "song-2", "Song 2");
        seed_song(&db, "song-3", "Song 3");
        seed_song(&db, "song-4", "Song 4");

        let playlist = db
            .playlist_create("Workout", None, false)
            .expect("failed to create playlist");

        let added = db
            .playlist_add_songs(
                &playlist.id,
                &[
                    String::from("song-1"),
                    String::from("song-2"),
                    String::from("song-2"),
                    String::from("song-3"),
                    String::from("missing-song"),
                ],
                None,
            )
            .expect("failed to add songs");
        assert_eq!(added.affected, 3);

        db.playlist_add_songs(&playlist.id, &[String::from("song-4")], Some(1))
            .expect("failed to insert song at index");

        let tracks_after_insert = db
            .playlist_get_tracks(&playlist.id)
            .expect("failed to list tracks after insert");
        assert_eq!(tracks_after_insert.iter().map(|track| track.song.id.as_str()).collect::<Vec<_>>(), vec!["song-1", "song-4", "song-2", "song-3"]);
        assert_eq!(tracks_after_insert.iter().map(|track| track.position).collect::<Vec<_>>(), vec![0, 1, 2, 3]);

        db.playlist_remove_songs(&playlist.id, &[String::from("song-2")])
            .expect("failed to remove song");
        db.playlist_reorder_tracks(
            &playlist.id,
            &[String::from("song-3"), String::from("song-1")],
        )
        .expect("failed to reorder tracks");

        let tracks_after_reorder = db
            .playlist_get_tracks(&playlist.id)
            .expect("failed to list tracks after reorder");
        assert_eq!(tracks_after_reorder.iter().map(|track| track.song.id.as_str()).collect::<Vec<_>>(), vec!["song-3", "song-1", "song-4"]);
        assert_eq!(tracks_after_reorder.iter().map(|track| track.position).collect::<Vec<_>>(), vec![0, 1, 2]);
    }
}
