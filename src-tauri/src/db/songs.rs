use super::search::escape_like_pattern;
use super::utils::{
    build_placeholders, build_song_tag_clause_values, hydrate_song_tags, normalize_string_ids,
    normalize_tag_ids,
};
use super::*;
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter};
use std::collections::{HashMap, HashSet};

impl Database {
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
                    file_modified_at,
                    is_missing
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 0)
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
                    is_missing = 0,
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

    pub fn get_song_count(&self, tag_ids: &[String]) -> Result<i64, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let normalized_tag_ids = normalize_tag_ids(tag_ids);
        if normalized_tag_ids.is_empty() {
            return connection
                .query_row(
                    "SELECT COUNT(*) FROM songs WHERE is_missing = 0",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| format!("failed to count songs: {error}"));
        }

        let placeholders = build_placeholders(normalized_tag_ids.len());
        let required_count = normalized_tag_ids.len() as i64;
        let query = format!(
            "
            SELECT COUNT(*)
            FROM (
                SELECT s.id
                FROM songs s
                INNER JOIN song_tags st ON st.song_id = s.id
                WHERE s.is_missing = 0
                  AND st.tag_id IN ({placeholders})
                GROUP BY s.id
                HAVING COUNT(DISTINCT st.tag_id) = ?
            )
            "
        );

        let mut values = normalized_tag_ids
            .into_iter()
            .map(SqlValue::from)
            .collect::<Vec<_>>();
        values.push(SqlValue::Integer(required_count));

        connection
            .query_row(&query, params_from_iter(values), |row| row.get::<_, i64>(0))
            .map_err(|error| format!("failed to count songs by tags: {error}"))
    }

    pub fn get_songs(
        &self,
        limit: u32,
        offset: u32,
        sort: &str,
        order: &str,
        tag_ids: &[String],
    ) -> Result<Vec<SongListItem>, String> {
        let sort_column = match sort {
            "title" => "s.title COLLATE NOCASE",
            "artist" => "s.artist COLLATE NOCASE",
            "album" => "s.album COLLATE NOCASE",
            "date_added" => "s.date_added",
            "play_count" => "s.play_count",
            "duration_ms" => "s.duration_ms",
            _ => "s.title COLLATE NOCASE",
        };

        let sort_order = if order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };

        let normalized_tag_ids = normalize_tag_ids(tag_ids);
        let (tag_clause, mut values) = build_song_tag_clause_values(&normalized_tag_ids);
        values.push(SqlValue::Integer(i64::from(limit)));
        values.push(SqlValue::Integer(i64::from(offset)));

        let query = format!(
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
                s.comment,
                s.date_added
            FROM songs s
            WHERE s.is_missing = 0
              {tag_clause}
            ORDER BY {sort_column} {sort_order}
            LIMIT ? OFFSET ?
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
            .query_map(params_from_iter(values), |row| {
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
                    comment: row.get(9)?,
                    tags: Vec::new(),
                    date_added: row.get(10)?,
                })
            })
            .map_err(|error| format!("failed to query songs: {error}"))?;

        let mut songs = Vec::new();
        for row in rows {
            songs.push(row.map_err(|error| format!("failed to read song row: {error}"))?);
        }

        hydrate_song_tags(&connection, &mut songs)?;
        Ok(songs)
    }

    pub fn get_sorted_song_ids(
        &self,
        sort: &str,
        order: &str,
        tag_ids: &[String],
    ) -> Result<Vec<String>, String> {
        let sort_column = match sort {
            "title" => "s.title COLLATE NOCASE",
            "artist" => "s.artist COLLATE NOCASE",
            "album" => "s.album COLLATE NOCASE",
            "date_added" => "s.date_added",
            "play_count" => "s.play_count",
            "duration_ms" => "s.duration_ms",
            _ => "s.title COLLATE NOCASE",
        };

        let sort_order = if order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };

        let normalized_tag_ids = normalize_tag_ids(tag_ids);
        let (tag_clause, values) = build_song_tag_clause_values(&normalized_tag_ids);

        let query = format!(
            "
            SELECT s.id
            FROM songs s
            WHERE s.is_missing = 0
              {tag_clause}
            ORDER BY {sort_column} {sort_order}
            "
        );

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("failed to prepare sorted song ids query: {error}"))?;

        let rows = statement
            .query_map(params_from_iter(values), |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to query sorted song ids: {error}"))?;

        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|error| format!("failed to read song id row: {error}"))?);
        }

        Ok(ids)
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
                comment,
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
                    comment: row.get(9)?,
                    tags: Vec::new(),
                    date_added: row.get(10)?,
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

        hydrate_song_tags(&connection, &mut ordered)?;
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
            WHERE is_missing = 0
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

    pub fn get_album_tracks(
        &self,
        album: &str,
        album_artist: &str,
    ) -> Result<Vec<SongListItem>, String> {
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
                    comment,
                    date_added
                FROM songs
                WHERE album = ?1
                  AND is_missing = 0
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
                    comment: row.get(9)?,
                    tags: Vec::new(),
                    date_added: row.get(10)?,
                })
            })
            .map_err(|error| format!("failed to query album tracks: {error}"))?;

        let mut tracks = Vec::new();
        for row in rows {
            tracks.push(row.map_err(|error| format!("failed to decode album track: {error}"))?);
        }

        hydrate_song_tags(&connection, &mut tracks)?;
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
            WHERE is_missing = 0
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
                  AND is_missing = 0
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
            albums
                .push(row.map_err(|error| format!("failed to decode artist album row: {error}"))?);
        }

        Ok(albums)
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
                  AND is_missing = 0
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
    pub fn song_update_comment(&self, song_id: &str, comment: Option<&str>) -> Result<(), String> {
        let normalized_comment = comment
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from);

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let affected = connection
            .execute(
                "
                UPDATE songs
                SET comment = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                ",
                params![song_id, normalized_comment],
            )
            .map_err(|error| format!("failed to update song comment: {error}"))?;

        if affected == 0 {
            return Err(String::from("song not found"));
        }

        Ok(())
    }

    pub fn song_set_custom_start(&self, song_id: &str, custom_start_ms: i64) -> Result<(), String> {
        let clamped = custom_start_ms.max(0);
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let affected = connection
            .execute(
                "
                UPDATE songs
                SET custom_start_ms = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?1
                ",
                params![song_id, clamped],
            )
            .map_err(|error| format!("failed to update custom start time: {error}"))?;

        if affected == 0 {
            return Err(String::from("song not found"));
        }

        Ok(())
    }

    pub fn mark_songs_missing_by_paths(&self, file_paths: &[String]) -> Result<i64, String> {
        let deduped = normalize_string_ids(file_paths);
        if deduped.is_empty() {
            return Ok(0);
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start mark-missing transaction: {error}"))?;

        let mut affected: i64 = 0;
        {
            let mut statement = transaction
                .prepare(
                    "
                    UPDATE songs
                    SET is_missing = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE file_path = ?1
                       OR file_path LIKE ?2 ESCAPE '\\'
                    ",
                )
                .map_err(|error| format!("failed to prepare mark-missing statement: {error}"))?;

            for file_path in deduped {
                let like_prefix =
                    format!("{}/%", escape_like_pattern(&file_path.replace('\\', "/")));
                let changed = statement
                    .execute(params![file_path, like_prefix])
                    .map_err(|error| format!("failed to mark missing song: {error}"))?;
                affected += changed as i64;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit mark-missing transaction: {error}"))?;

        Ok(affected)
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
                WHERE is_missing = 0
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
            songs.push(
                row.map_err(|error| format!("failed to decode match candidate row: {error}"))?,
            );
        }

        Ok(songs)
    }
}
