use super::*;
use chrono::{DateTime, Utc};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection};
use std::collections::{HashMap, HashSet};

pub(super) fn get_tag_by_id(connection: &Connection, tag_id: &str) -> Result<Tag, String> {
    connection
        .query_row(
            "
            SELECT id, name, color
            FROM tags
            WHERE id = ?1
            ",
            params![tag_id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            },
        )
        .map_err(|error| format!("failed to load tag {tag_id}: {error}"))
}

pub(super) fn normalize_tag_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(String::from("tag name cannot be empty"));
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_tag_color(color: &str) -> String {
    let trimmed = color.trim();
    if trimmed.starts_with('#') && (trimmed.len() == 7 || trimmed.len() == 4) {
        return trimmed.to_string();
    }
    String::from("#A8D8EA")
}

pub(super) fn normalize_string_ids(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

pub(super) fn normalize_tag_ids(tag_ids: &[String]) -> Vec<String> {
    normalize_string_ids(tag_ids)
}

pub(super) fn build_placeholders(count: usize) -> String {
    (0..count).map(|_| "?").collect::<Vec<_>>().join(", ")
}

pub(super) fn build_song_tag_clause_values(tag_ids: &[String]) -> (String, Vec<SqlValue>) {
    let normalized_tag_ids = normalize_tag_ids(tag_ids);
    if normalized_tag_ids.is_empty() {
        return (String::new(), Vec::new());
    }

    let placeholders = build_placeholders(normalized_tag_ids.len());
    let mut values = normalized_tag_ids
        .iter()
        .cloned()
        .map(SqlValue::from)
        .collect::<Vec<_>>();
    values.push(SqlValue::Integer(normalized_tag_ids.len() as i64));

    (
        format!(
            "
              AND s.id IN (
                  SELECT st.song_id
                  FROM song_tags st
                  WHERE st.tag_id IN ({placeholders})
                  GROUP BY st.song_id
                  HAVING COUNT(DISTINCT st.tag_id) = ?
              )
            "
        ),
        values,
    )
}

pub(super) fn hydrate_song_tags(
    connection: &Connection,
    songs: &mut [SongListItem],
) -> Result<(), String> {
    if songs.is_empty() {
        return Ok(());
    }

    let mut song_ids = Vec::with_capacity(songs.len());
    let mut seen = HashSet::<String>::new();
    for song in songs.iter() {
        if seen.insert(song.id.clone()) {
            song_ids.push(song.id.clone());
        }
    }

    let placeholders = build_placeholders(song_ids.len());
    let query = format!(
        "
        SELECT st.song_id, t.id, t.name, t.color
        FROM song_tags st
        INNER JOIN tags t ON t.id = st.tag_id
        WHERE st.song_id IN ({placeholders})
        ORDER BY t.name COLLATE NOCASE ASC
        "
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("failed to prepare song tag hydration query: {error}"))?;

    let rows = statement
        .query_map(
            params_from_iter(song_ids.into_iter().map(SqlValue::from)),
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Tag {
                        id: row.get(1)?,
                        name: row.get(2)?,
                        color: row.get(3)?,
                    },
                ))
            },
        )
        .map_err(|error| format!("failed to query song tags: {error}"))?;

    let mut tags_by_song_id = HashMap::<String, Vec<Tag>>::new();
    for row in rows {
        let (song_id, tag) =
            row.map_err(|error| format!("failed to decode song tag row: {error}"))?;
        tags_by_song_id.entry(song_id).or_default().push(tag);
    }

    for song in songs {
        song.tags = tags_by_song_id.remove(&song.id).unwrap_or_default();
    }

    Ok(())
}

pub(super) fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub fn to_sqlite_timestamp(datetime: DateTime<Utc>) -> String {
    datetime.to_rfc3339()
}
