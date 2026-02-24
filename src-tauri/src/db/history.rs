use super::*;
use rusqlite::params;

impl Database {
    pub fn history_record_start(&self, id: &str, song_id: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .execute(
                "INSERT INTO play_history (id, song_id) VALUES (?1, ?2)",
                params![id, song_id],
            )
            .map_err(|error| format!("failed to record play start: {error}"))?;

        Ok(())
    }

    pub fn history_record_end(
        &self,
        id: &str,
        duration_played_ms: i64,
        completed: bool,
    ) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let completed_int: i64 = if completed { 1 } else { 0 };
        connection
            .execute(
                "
                UPDATE play_history
                SET ended_at = CURRENT_TIMESTAMP,
                    duration_played_ms = ?2,
                    completed = ?3
                WHERE id = ?1
                ",
                params![id, duration_played_ms, completed_int],
            )
            .map_err(|error| format!("failed to record play end: {error}"))?;

        if completed {
            let song_id: Option<String> = connection
                .query_row(
                    "SELECT song_id FROM play_history WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("failed to look up play history song_id: {error}"))?;

            if let Some(song_id) = song_id {
                connection
                    .execute(
                        "
                        UPDATE songs
                        SET play_count = play_count + 1,
                            last_played_at = CURRENT_TIMESTAMP
                        WHERE id = ?1
                        ",
                        params![song_id],
                    )
                    .map_err(|error| format!("failed to increment play count: {error}"))?;
            }
        }

        Ok(())
    }

    pub fn history_record_skip(&self, song_id: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .execute(
                "UPDATE songs SET skip_count = skip_count + 1 WHERE id = ?1",
                params![song_id],
            )
            .map_err(|error| format!("failed to increment skip count: {error}"))?;

        Ok(())
    }

    pub fn history_get_page(&self, limit: i64, offset: i64) -> Result<PlayHistoryPage, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let total: i64 = connection
            .query_row("SELECT COUNT(*) FROM play_history", [], |row| row.get(0))
            .map_err(|error| format!("failed to count play history: {error}"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT ph.id, ph.song_id, s.title, s.artist, s.album, s.artwork_path,
                       ph.started_at, ph.duration_played_ms, ph.completed
                FROM play_history ph
                INNER JOIN songs s ON s.id = ph.song_id
                ORDER BY ph.started_at DESC
                LIMIT ?1 OFFSET ?2
                ",
            )
            .map_err(|error| format!("failed to prepare play history query: {error}"))?;

        let entries = statement
            .query_map(params![limit, offset], |row| {
                Ok(PlayHistoryEntry {
                    id: row.get(0)?,
                    song_id: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    artwork_path: row.get(5)?,
                    started_at: row.get(6)?,
                    duration_played_ms: row.get(7)?,
                    completed: row.get::<_, i64>(8)? != 0,
                })
            })
            .map_err(|error| format!("failed to query play history: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode play history row: {error}"))?;

        Ok(PlayHistoryPage { entries, total })
    }
}
