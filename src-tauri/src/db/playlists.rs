use super::utils::{bool_to_i64, hydrate_song_tags};
use super::*;
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

impl Database {
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
        let resolved_name =
            resolve_unique_playlist_name(&transaction, parent_id, &requested_name, None)?;
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
                .map_err(|error| {
                    format!("failed to prepare playlist track duplicate statement: {error}")
                })?;

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
                return Err(String::from(
                    "cannot move a playlist into one of its descendants",
                ));
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

        ensure_playlist_is_track_container(&connection, playlist_id)?;
        query_playlist_tracks(&connection, playlist_id, None, None)
    }

    pub fn playlist_get_track_count(&self, playlist_id: &str) -> Result<i64, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        ensure_playlist_is_track_container(&connection, playlist_id)?;

        connection
            .query_row(
                "
                SELECT COUNT(*)
                FROM playlist_tracks pt
                INNER JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = ?1
                  AND s.is_missing = 0
                ",
                params![playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("failed to count playlist tracks: {error}"))
    }

    pub fn playlist_get_tracks_page(
        &self,
        playlist_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<PlaylistTrackItem>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        ensure_playlist_is_track_container(&connection, playlist_id)?;
        query_playlist_tracks(&connection, playlist_id, Some(limit), Some(offset))
    }

    pub fn playlist_get_track_ids(&self, playlist_id: &str) -> Result<Vec<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        ensure_playlist_is_track_container(&connection, playlist_id)?;

        let mut statement = connection
            .prepare(
                "
                SELECT s.id
                FROM playlist_tracks pt
                INNER JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = ?1
                  AND s.is_missing = 0
                ORDER BY pt.position ASC, pt.added_at ASC
                ",
            )
            .map_err(|error| format!("failed to prepare playlist track ids query: {error}"))?;

        let rows = statement
            .query_map(params![playlist_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to query playlist track ids: {error}"))?;

        let mut song_ids = Vec::new();
        for row in rows {
            song_ids.push(
                row.map_err(|error| format!("failed to decode playlist track id row: {error}"))?,
            );
        }

        Ok(song_ids)
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
                .prepare("SELECT 1 FROM songs WHERE id = ?1 AND is_missing = 0 LIMIT 1")
                .map_err(|error| format!("failed to prepare song existence query: {error}"))?;
            let mut existing_in_playlist_query = transaction
                .prepare(
                    "SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND song_id = ?2 LIMIT 1",
                )
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
                    .map_err(|error| {
                        format!("failed to validate playlist duplicate for song {song_id}: {error}")
                    })?
                    .is_some();
                if already_in_playlist {
                    continue;
                }

                candidates.push(song_id.clone());
            }
        }

        if candidates.is_empty() {
            transaction.commit().map_err(|error| {
                format!("failed to commit empty playlist add transaction: {error}")
            })?;
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
                params![
                    playlist_id,
                    candidates.len() as i64,
                    bounded_insert_index as i64
                ],
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
                .map_err(|error| {
                    format!("failed to prepare playlist track insert statement: {error}")
                })?;

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
        let transaction = connection.transaction().map_err(|error| {
            format!("failed to start playlist remove songs transaction: {error}")
        })?;

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

        transaction.commit().map_err(|error| {
            format!("failed to commit playlist remove songs transaction: {error}")
        })?;

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
            transaction.commit().map_err(|error| {
                format!("failed to commit empty playlist reorder transaction: {error}")
            })?;
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
                .map_err(|error| {
                    format!("failed to prepare playlist reorder update statement: {error}")
                })?;

            for (position, song_id) in reordered.iter().enumerate() {
                update_statement
                    .execute(params![playlist_id, song_id, position as i64])
                    .map_err(|error| {
                        format!("failed to update playlist track position: {error}")
                    })?;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit playlist reorder transaction: {error}"))?;

        Ok(())
    }
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

fn query_playlist_tracks(
    connection: &Connection,
    playlist_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<PlaylistTrackItem>, String> {
    let pagination_clause = if limit.is_some() && offset.is_some() {
        "LIMIT ?2 OFFSET ?3"
    } else {
        ""
    };

    let query = format!(
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
            s.comment,
            s.date_added
        FROM playlist_tracks pt
        INNER JOIN songs s ON s.id = pt.song_id
        WHERE pt.playlist_id = ?1
          AND s.is_missing = 0
        ORDER BY pt.position ASC, pt.added_at ASC
        {pagination_clause}
        "
    );

    let mut values = vec![SqlValue::from(playlist_id.to_string())];
    if let (Some(limit), Some(offset)) = (limit, offset) {
        values.push(SqlValue::Integer(i64::from(limit)));
        values.push(SqlValue::Integer(i64::from(offset)));
    }

    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("failed to prepare playlist tracks query: {error}"))?;

    let rows = statement
        .query_map(params_from_iter(values), |row| {
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
                    comment: row.get(11)?,
                    tags: Vec::new(),
                    date_added: row.get(12)?,
                },
            })
        })
        .map_err(|error| format!("failed to query playlist tracks: {error}"))?;

    let mut tracks = Vec::new();
    for row in rows {
        tracks.push(row.map_err(|error| format!("failed to decode playlist track row: {error}"))?);
    }

    let mut songs = tracks
        .iter()
        .map(|track| track.song.clone())
        .collect::<Vec<_>>();
    hydrate_song_tags(connection, &mut songs)?;
    let tags_by_song_id = songs
        .into_iter()
        .map(|song| (song.id, song.tags))
        .collect::<HashMap<_, _>>();
    for track in &mut tracks {
        track.song.tags = tags_by_song_id
            .get(&track.song.id)
            .cloned()
            .unwrap_or_default();
    }

    Ok(tracks)
}

fn ensure_playlist_is_track_container(
    connection: &Connection,
    playlist_id: &str,
) -> Result<(), String> {
    let playlist = get_playlist_node_with_connection(connection, playlist_id)?;
    if playlist.is_folder {
        return Err(String::from("folders cannot contain tracks"));
    }
    Ok(())
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

fn get_playlist_node_with_tx(
    transaction: &Transaction<'_>,
    playlist_id: &str,
) -> Result<PlaylistNode, String> {
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

fn ensure_valid_parent_folder(
    transaction: &Transaction<'_>,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };

    let parent = get_playlist_node_with_tx(transaction, parent_id)?;
    if !parent.is_folder {
        return Err(String::from("parent playlist must be a folder"));
    }

    Ok(())
}

fn ensure_playlist_accepts_tracks(
    transaction: &Transaction<'_>,
    playlist_id: &str,
) -> Result<(), String> {
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

fn next_playlist_sort_order(
    transaction: &Transaction<'_>,
    parent_id: Option<&str>,
) -> Result<i64, String> {
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
        song_ids.push(
            row.map_err(|error| format!("failed to decode playlist track order row: {error}"))?,
        );
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
        .map_err(|error| {
            format!("failed to prepare playlist position rebalance statement: {error}")
        })?;

    for (position, song_id) in song_ids.iter().enumerate() {
        update_statement
            .execute(params![playlist_id, song_id, position as i64])
            .map_err(|error| format!("failed to rebalance playlist positions: {error}"))?;
    }
    Ok(())
}
