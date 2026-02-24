use crate::db::{self, ExportHierarchyPlaylist};
use crate::state::AppState;
use std::io::Write;
use tauri::State;

#[tauri::command]
pub fn export_playlist_m3u8(
    state: State<'_, AppState>,
    playlist_id: String,
    output_path: String,
) -> Result<(), String> {
    let tracks = state.db.playlist_get_tracks(&playlist_id)?;

    let mut file = std::fs::File::create(&output_path)
        .map_err(|error| format!("failed to create M3U8 file: {error}"))?;

    writeln!(file, "#EXTM3U").map_err(|error| format!("failed to write M3U8 header: {error}"))?;

    for track in &tracks {
        let duration_secs = track.song.duration_ms / 1000;
        let display_name = format!("{} - {}", track.song.artist, track.song.title);
        writeln!(file, "#EXTINF:{duration_secs},{display_name}")
            .map_err(|error| format!("failed to write M3U8 entry: {error}"))?;
        writeln!(file, "{}", track.song.file_path)
            .map_err(|error| format!("failed to write M3U8 path: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn export_play_stats_csv(
    state: State<'_, AppState>,
    output_path: String,
) -> Result<(), String> {
    let rows = state.db.export_play_stats_rows()?;

    let mut file = std::fs::File::create(&output_path)
        .map_err(|error| format!("failed to create CSV file: {error}"))?;

    writeln!(
        file,
        "Title,Artist,Album,Play Count,Total Listen (ms),Last Played,Tags"
    )
    .map_err(|error| format!("failed to write CSV header: {error}"))?;

    for row in &rows {
        writeln!(
            file,
            "{},{},{},{},{},{},{}",
            db::escape_csv(&row.title),
            db::escape_csv(&row.artist),
            db::escape_csv(&row.album),
            row.play_count,
            row.total_listen_ms,
            db::escape_csv(row.last_played.as_deref().unwrap_or("")),
            db::escape_csv(&row.tags),
        )
        .map_err(|error| format!("failed to write CSV row: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn export_tags_csv(state: State<'_, AppState>, output_path: String) -> Result<(), String> {
    let rows = state.db.export_tags_rows()?;
    let tag_columns = db::max_export_tag_columns(&rows);

    let mut file = std::fs::File::create(&output_path)
        .map_err(|error| format!("failed to create CSV file: {error}"))?;

    let mut header = vec![
        String::from("Title"),
        String::from("Artist"),
        String::from("Album"),
    ];
    for index in 0..tag_columns {
        header.push(format!("Tag{}", index + 1));
    }
    writeln!(
        file,
        "{}",
        header
            .iter()
            .map(|value| db::escape_csv(value))
            .collect::<Vec<_>>()
            .join(",")
    )
    .map_err(|error| format!("failed to write CSV header: {error}"))?;

    for row in &rows {
        let mut values = vec![
            db::escape_csv(&row.title),
            db::escape_csv(&row.artist),
            db::escape_csv(&row.album),
        ];
        for index in 0..tag_columns {
            let value = row.tags.get(index).map(String::as_str).unwrap_or("");
            values.push(db::escape_csv(value));
        }
        writeln!(file, "{}", values.join(","))
            .map_err(|error| format!("failed to write CSV row: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn export_library_hierarchy_md(
    state: State<'_, AppState>,
    output_path: String,
) -> Result<(), String> {
    let playlists = state.db.export_hierarchy_data()?;

    let mut file = std::fs::File::create(&output_path)
        .map_err(|error| format!("failed to create markdown file: {error}"))?;

    writeln!(file, "# My Music Library")
        .map_err(|error| format!("failed to write markdown header: {error}"))?;
    writeln!(file).map_err(|error| format!("failed to write newline: {error}"))?;

    fn write_node(
        file: &mut std::fs::File,
        playlists: &[ExportHierarchyPlaylist],
        parent_id: Option<&str>,
        depth: usize,
    ) -> Result<(), String> {
        let children: Vec<_> = playlists
            .iter()
            .filter(|p| p.parent_id.as_deref() == parent_id)
            .collect();

        for child in children {
            if child.is_folder {
                let heading_level = "#".repeat((depth + 2).min(6));
                writeln!(file, "{heading_level} {}", child.name)
                    .map_err(|error| format!("failed to write folder heading: {error}"))?;
                write_node(file, playlists, Some(&child.id), depth + 1)?;
                writeln!(file).map_err(|error| format!("failed to write newline: {error}"))?;
            } else {
                let indent = "  ".repeat(depth);
                writeln!(file, "{indent}- **{}**", child.name)
                    .map_err(|error| format!("failed to write playlist name: {error}"))?;
                for track in &child.tracks {
                    writeln!(
                        file,
                        "{indent}  - {} \u{2014} {}",
                        track.title, track.artist
                    )
                    .map_err(|error| format!("failed to write track: {error}"))?;
                }
            }
        }

        Ok(())
    }

    write_node(&mut file, &playlists, None, 0)?;

    Ok(())
}
