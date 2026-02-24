use super::*;
use rusqlite::params;

impl Database {
    pub fn export_play_stats_rows(&self) -> Result<Vec<ExportPlayStatRow>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT s.title, s.artist, s.album, s.play_count,
                       COALESCE((SELECT SUM(ph.duration_played_ms)
                                 FROM play_history ph WHERE ph.song_id = s.id), 0),
                       s.last_played_at,
                       COALESCE((SELECT GROUP_CONCAT(t.name, ', ')
                                 FROM song_tags st
                                 INNER JOIN tags t ON t.id = st.tag_id
                                 WHERE st.song_id = s.id), '')
                FROM songs s
                WHERE s.is_missing = 0
                ORDER BY s.title COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare export play stats query: {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok(ExportPlayStatRow {
                    title: row.get(0)?,
                    artist: row.get(1)?,
                    album: row.get(2)?,
                    play_count: row.get(3)?,
                    total_listen_ms: row.get(4)?,
                    last_played: row.get(5)?,
                    tags: row.get(6)?,
                })
            })
            .map_err(|error| format!("failed to query export play stats: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode export play stat row: {error}"))?;

        Ok(rows)
    }

    pub fn export_tags_rows(&self) -> Result<Vec<ExportTagRow>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT s.id, s.title, s.artist, s.album
                FROM songs s
                WHERE s.is_missing = 0
                ORDER BY s.title COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare export tags query: {error}"))?;

        let song_rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| format!("failed to query export songs: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode export songs row: {error}"))?;

        let mut tag_stmt = connection
            .prepare(
                "
                SELECT t.name
                FROM song_tags st
                INNER JOIN tags t ON t.id = st.tag_id
                WHERE st.song_id = ?1
                ORDER BY t.name COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare tag lookup: {error}"))?;

        let mut rows = Vec::with_capacity(song_rows.len());
        for (id, title, artist, album) in song_rows {
            let song_tags: Vec<String> = tag_stmt
                .query_map(params![id], |row| row.get(0))
                .map_err(|error| format!("failed to query song tags for export: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("failed to decode tag row: {error}"))?;

            rows.push(ExportTagRow {
                title,
                artist,
                album,
                tags: song_tags,
            });
        }

        Ok(rows)
    }

    pub fn export_hierarchy_data(&self) -> Result<Vec<ExportHierarchyPlaylist>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut playlist_stmt = connection
            .prepare(
                "
                SELECT id, name, parent_id, is_folder, sort_order
                FROM playlists
                ORDER BY sort_order ASC
                ",
            )
            .map_err(|error| format!("failed to prepare hierarchy playlist query: {error}"))?;

        let playlists = playlist_stmt
            .query_map([], |row| {
                Ok(ExportHierarchyPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    is_folder: row.get::<_, i64>(3)? != 0,
                    sort_order: row.get(4)?,
                    tracks: Vec::new(),
                })
            })
            .map_err(|error| format!("failed to query hierarchy playlists: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode hierarchy playlist row: {error}"))?;

        let mut track_stmt = connection
            .prepare(
                "
                SELECT s.title, s.artist
                FROM playlist_tracks pt
                INNER JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = ?1
                ORDER BY pt.position ASC
                ",
            )
            .map_err(|error| format!("failed to prepare hierarchy track query: {error}"))?;

        let mut result = Vec::with_capacity(playlists.len());
        for mut playlist in playlists {
            if !playlist.is_folder {
                let tracks = track_stmt
                    .query_map(params![playlist.id], |row| {
                        Ok(ExportHierarchyTrack {
                            title: row.get(0)?,
                            artist: row.get(1)?,
                        })
                    })
                    .map_err(|error| format!("failed to query hierarchy tracks: {error}"))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| format!("failed to decode hierarchy track row: {error}"))?;
                playlist.tracks = tracks;
            }
            result.push(playlist);
        }

        Ok(result)
    }
}

pub fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

pub fn max_export_tag_columns(rows: &[ExportTagRow]) -> usize {
    rows.iter().map(|row| row.tags.len()).max().unwrap_or(0)
}
