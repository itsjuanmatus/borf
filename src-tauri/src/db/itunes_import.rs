use super::utils::bool_to_i64;
use super::*;
use rusqlite::{params, OptionalExtension, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

impl Database {
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
                .map_err(|error| {
                    format!("failed to prepare iTunes song update statement: {error}")
                })?;

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
