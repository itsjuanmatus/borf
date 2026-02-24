use super::utils::{
    build_song_tag_clause_values, get_tag_by_id, hydrate_song_tags, normalize_string_ids,
    normalize_tag_color, normalize_tag_ids, normalize_tag_name,
};
use super::*;
use rusqlite::{params, params_from_iter};
use uuid::Uuid;

impl Database {
    pub fn tags_list(&self) -> Result<Vec<Tag>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let mut statement = connection
            .prepare(
                "
                SELECT id, name, color
                FROM tags
                ORDER BY name COLLATE NOCASE ASC
                ",
            )
            .map_err(|error| format!("failed to prepare tags list query: {error}"))?;

        let rows = statement
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .map_err(|error| format!("failed to query tags list: {error}"))?;

        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|error| format!("failed to decode tag row: {error}"))?);
        }

        Ok(tags)
    }

    pub fn tags_create(&self, name: &str, color: &str) -> Result<Tag, String> {
        let normalized_name = normalize_tag_name(name)?;
        let normalized_color = normalize_tag_color(color);
        let tag_id = Uuid::new_v4().to_string();

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .execute(
                "
                INSERT INTO tags (id, name, color)
                VALUES (?1, ?2, ?3)
                ",
                params![tag_id, normalized_name, normalized_color],
            )
            .map_err(|error| format!("failed to create tag: {error}"))?;

        get_tag_by_id(&connection, &tag_id)
    }

    pub fn tags_rename(&self, tag_id: &str, name: &str) -> Result<Tag, String> {
        let normalized_name = normalize_tag_name(name)?;

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let affected = connection
            .execute(
                "
                UPDATE tags
                SET name = ?1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?2
                ",
                params![normalized_name, tag_id],
            )
            .map_err(|error| format!("failed to rename tag: {error}"))?;

        if affected == 0 {
            return Err(String::from("tag not found"));
        }

        get_tag_by_id(&connection, tag_id)
    }

    pub fn tags_set_color(&self, tag_id: &str, color: &str) -> Result<Tag, String> {
        let normalized_color = normalize_tag_color(color);

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let affected = connection
            .execute(
                "
                UPDATE tags
                SET color = ?1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?2
                ",
                params![normalized_color, tag_id],
            )
            .map_err(|error| format!("failed to update tag color: {error}"))?;

        if affected == 0 {
            return Err(String::from("tag not found"));
        }

        get_tag_by_id(&connection, tag_id)
    }

    pub fn tags_delete(&self, tag_id: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let affected = connection
            .execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
            .map_err(|error| format!("failed to delete tag: {error}"))?;

        if affected == 0 {
            return Err(String::from("tag not found"));
        }
        Ok(())
    }

    pub fn tags_assign(
        &self,
        song_ids: &[String],
        tag_ids: &[String],
    ) -> Result<PlaylistMutationResult, String> {
        let normalized_song_ids = normalize_string_ids(song_ids);
        let normalized_tag_ids = normalize_tag_ids(tag_ids);

        if normalized_song_ids.is_empty() || normalized_tag_ids.is_empty() {
            return Ok(PlaylistMutationResult { affected: 0 });
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start tag assign transaction: {error}"))?;

        let mut affected: i64 = 0;
        {
            let mut insert_statement = transaction
                .prepare(
                    "
                    INSERT OR IGNORE INTO song_tags (song_id, tag_id)
                    VALUES (?1, ?2)
                    ",
                )
                .map_err(|error| format!("failed to prepare tag assign statement: {error}"))?;

            for song_id in &normalized_song_ids {
                for tag_id in &normalized_tag_ids {
                    let inserted = insert_statement
                        .execute(params![song_id, tag_id])
                        .map_err(|error| format!("failed to assign tag to song: {error}"))?;
                    affected += inserted as i64;
                }
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit tag assign transaction: {error}"))?;

        Ok(PlaylistMutationResult { affected })
    }

    pub fn tags_remove(
        &self,
        song_ids: &[String],
        tag_ids: &[String],
    ) -> Result<PlaylistMutationResult, String> {
        let normalized_song_ids = normalize_string_ids(song_ids);
        let normalized_tag_ids = normalize_tag_ids(tag_ids);

        if normalized_song_ids.is_empty() || normalized_tag_ids.is_empty() {
            return Ok(PlaylistMutationResult { affected: 0 });
        }

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start tag remove transaction: {error}"))?;

        let mut affected: i64 = 0;
        {
            let mut delete_statement = transaction
                .prepare(
                    "
                    DELETE FROM song_tags
                    WHERE song_id = ?1 AND tag_id = ?2
                    ",
                )
                .map_err(|error| format!("failed to prepare tag remove statement: {error}"))?;

            for song_id in &normalized_song_ids {
                for tag_id in &normalized_tag_ids {
                    let removed = delete_statement
                        .execute(params![song_id, tag_id])
                        .map_err(|error| format!("failed to remove tag from song: {error}"))?;
                    affected += removed as i64;
                }
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit tag remove transaction: {error}"))?;

        Ok(PlaylistMutationResult { affected })
    }

    pub fn tags_get_songs_by_tag(&self, tag_ids: &[String]) -> Result<Vec<SongListItem>, String> {
        let normalized_tag_ids = normalize_tag_ids(tag_ids);
        if normalized_tag_ids.is_empty() {
            return Ok(Vec::new());
        }

        let (tag_clause, mut values) = build_song_tag_clause_values(&normalized_tag_ids);
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
            ORDER BY s.title COLLATE NOCASE ASC
            "
        );

        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;
        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("failed to prepare tags get songs query: {error}"))?;
        let rows = statement
            .query_map(params_from_iter(values.drain(..)), |row| {
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
            .map_err(|error| format!("failed to query songs by tag: {error}"))?;

        let mut songs = Vec::new();
        for row in rows {
            songs.push(row.map_err(|error| format!("failed to decode songs by tag row: {error}"))?);
        }

        hydrate_song_tags(&connection, &mut songs)?;
        Ok(songs)
    }
}
