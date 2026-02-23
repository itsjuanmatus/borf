use crate::audio::AudioEngine;
use crate::db::{
    self, AlbumListItem, ArtistListItem, DashboardStats, LibrarySearchResult, PlayHistoryPage,
    PlaylistMutationResult, PlaylistNode, PlaylistTrackItem, SongListItem, Tag,
};
use crate::imports::itunes::{self, ItunesImportOptions, ItunesImportSummary, ItunesPreview};
use crate::library;
use crate::state::AppState;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn library_scan(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let db = state.db.clone();
    let folder = PathBuf::from(folder_path);
    let folder_for_scan = folder.clone();

    tauri::async_runtime::spawn_blocking(move || {
        library::scan_library(&app_handle, &db, &folder_for_scan)
    })
    .await
    .map_err(|error| format!("scan task failed: {error}"))??;

    state.library_watcher.watch_root(folder.clone())?;

    let mut roots = state.db.get_library_roots()?;
    let canonical_folder = std::fs::canonicalize(&folder).unwrap_or(folder);
    let folder_key = canonical_folder.to_string_lossy().to_string();
    if !roots.contains(&folder_key) {
        roots.push(folder_key);
        state.db.set_library_roots(&roots)?;
    }

    Ok(())
}

#[tauri::command]
pub fn library_get_song_count(
    state: State<'_, AppState>,
    tag_ids: Option<Vec<String>>,
) -> Result<i64, String> {
    state
        .db
        .get_song_count(tag_ids.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn library_get_songs(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
    tag_ids: Option<Vec<String>>,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_songs(
        limit,
        offset,
        &sort,
        &order,
        tag_ids.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn library_get_songs_by_ids(
    state: State<'_, AppState>,
    song_ids: Vec<String>,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_songs_by_ids(&song_ids)
}

#[tauri::command]
pub fn library_get_albums(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
) -> Result<Vec<AlbumListItem>, String> {
    state.db.get_albums(limit, offset, &sort, &order)
}

#[tauri::command]
pub fn library_get_album_tracks(
    state: State<'_, AppState>,
    album: String,
    album_artist: String,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_album_tracks(&album, &album_artist)
}

#[tauri::command]
pub fn library_get_artists(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
) -> Result<Vec<ArtistListItem>, String> {
    state.db.get_artists(limit, offset, &sort, &order)
}

#[tauri::command]
pub fn library_get_artist_albums(
    state: State<'_, AppState>,
    artist: String,
) -> Result<Vec<AlbumListItem>, String> {
    state.db.get_artist_albums(&artist)
}

#[tauri::command]
pub async fn library_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    tag_ids: Option<Vec<String>>,
) -> Result<LibrarySearchResult, String> {
    let db = state.db.clone();
    let limit = limit.unwrap_or(25);
    let tag_ids = tag_ids.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || db.search_library(&query, limit, &tag_ids))
        .await
        .map_err(|error| format!("search task failed: {error}"))?
}

#[tauri::command]
pub fn tags_list(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    state.db.tags_list()
}

#[tauri::command]
pub fn tags_create(state: State<'_, AppState>, name: String, color: String) -> Result<Tag, String> {
    state.db.tags_create(&name, &color)
}

#[tauri::command]
pub fn tags_rename(state: State<'_, AppState>, id: String, name: String) -> Result<Tag, String> {
    state.db.tags_rename(&id, &name)
}

#[tauri::command]
pub fn tags_set_color(
    state: State<'_, AppState>,
    id: String,
    color: String,
) -> Result<Tag, String> {
    state.db.tags_set_color(&id, &color)
}

#[tauri::command]
pub fn tags_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.tags_delete(&id)
}

#[tauri::command]
pub fn tags_assign(
    state: State<'_, AppState>,
    song_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<PlaylistMutationResult, String> {
    state.db.tags_assign(&song_ids, &tag_ids)
}

#[tauri::command]
pub fn tags_remove(
    state: State<'_, AppState>,
    song_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<PlaylistMutationResult, String> {
    state.db.tags_remove(&song_ids, &tag_ids)
}

#[tauri::command]
pub fn tags_get_songs_by_tag(
    state: State<'_, AppState>,
    tag_ids: Vec<String>,
) -> Result<Vec<SongListItem>, String> {
    state.db.tags_get_songs_by_tag(&tag_ids)
}

#[tauri::command]
pub fn song_update_comment(
    state: State<'_, AppState>,
    song_id: String,
    comment: Option<String>,
) -> Result<(), String> {
    state.db.song_update_comment(&song_id, comment.as_deref())
}

#[tauri::command]
pub fn song_set_custom_start(
    state: State<'_, AppState>,
    song_id: String,
    custom_start_ms: i64,
) -> Result<(), String> {
    state.db.song_set_custom_start(&song_id, custom_start_ms)
}

#[tauri::command]
pub fn playlist_list(state: State<'_, AppState>) -> Result<Vec<PlaylistNode>, String> {
    state.db.playlist_list()
}

#[tauri::command]
pub fn playlist_create(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
    is_folder: bool,
) -> Result<PlaylistNode, String> {
    state
        .db
        .playlist_create(&name, parent_id.as_deref(), is_folder)
}

#[tauri::command]
pub fn playlist_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<PlaylistNode, String> {
    state.db.playlist_rename(&id, &name)
}

#[tauri::command]
pub fn playlist_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.playlist_delete(&id)
}

#[tauri::command]
pub fn playlist_duplicate(state: State<'_, AppState>, id: String) -> Result<PlaylistNode, String> {
    state.db.playlist_duplicate(&id)
}

#[tauri::command]
pub fn playlist_move(
    state: State<'_, AppState>,
    id: String,
    new_parent_id: Option<String>,
    new_index: i64,
) -> Result<(), String> {
    state
        .db
        .playlist_move(&id, new_parent_id.as_deref(), new_index)
}

#[tauri::command]
pub fn playlist_get_tracks(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<PlaylistTrackItem>, String> {
    state.db.playlist_get_tracks(&playlist_id)
}

#[tauri::command]
pub fn playlist_get_track_count(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<i64, String> {
    state.db.playlist_get_track_count(&playlist_id)
}

#[tauri::command]
pub fn playlist_get_tracks_page(
    state: State<'_, AppState>,
    playlist_id: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<PlaylistTrackItem>, String> {
    state
        .db
        .playlist_get_tracks_page(&playlist_id, limit, offset)
}

#[tauri::command]
pub fn playlist_get_track_ids(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<String>, String> {
    state.db.playlist_get_track_ids(&playlist_id)
}

#[tauri::command]
pub fn playlist_add_songs(
    state: State<'_, AppState>,
    playlist_id: String,
    song_ids: Vec<String>,
    insert_index: Option<i64>,
) -> Result<PlaylistMutationResult, String> {
    state
        .db
        .playlist_add_songs(&playlist_id, &song_ids, insert_index)
}

#[tauri::command]
pub fn playlist_remove_songs(
    state: State<'_, AppState>,
    playlist_id: String,
    song_ids: Vec<String>,
) -> Result<PlaylistMutationResult, String> {
    state.db.playlist_remove_songs(&playlist_id, &song_ids)
}

#[tauri::command]
pub fn playlist_reorder_tracks(
    state: State<'_, AppState>,
    playlist_id: String,
    ordered_song_ids: Vec<String>,
) -> Result<(), String> {
    state
        .db
        .playlist_reorder_tracks(&playlist_id, &ordered_song_ids)
}

#[tauri::command]
pub async fn import_itunes_preview(
    state: State<'_, AppState>,
    xml_path: String,
) -> Result<ItunesPreview, String> {
    let db = state.db.clone();

    tauri::async_runtime::spawn_blocking(move || {
        itunes::preview_itunes_import(&db, Path::new(&xml_path))
    })
    .await
    .map_err(|error| format!("iTunes preview task failed: {error}"))?
}

#[tauri::command]
pub async fn import_itunes(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    xml_path: String,
    options: Option<ItunesImportOptions>,
) -> Result<ItunesImportSummary, String> {
    let db = state.db.clone();
    let import_options = options.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        itunes::run_itunes_import(&app_handle, &db, Path::new(&xml_path), import_options)
    })
    .await
    .map_err(|error| format!("iTunes import task failed: {error}"))?
}

#[tauri::command]
pub async fn audio_play(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
    start_ms: Option<u64>,
) -> Result<(), String> {
    let song = state.db.get_song_for_playback(&song_id)?;
    let result = state.audio.play(song, start_ms);

    if let Err(error) = &result {
        AudioEngine::emit_error(&app_handle, error.clone());
    }

    result
}

#[tauri::command]
pub fn audio_pause(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let result = state.audio.pause();
    if let Err(error) = &result {
        AudioEngine::emit_error(&app_handle, error.clone());
    }
    result
}

#[tauri::command]
pub fn audio_resume(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let result = state.audio.resume();
    if let Err(error) = &result {
        AudioEngine::emit_error(&app_handle, error.clone());
    }
    result
}

#[tauri::command]
pub fn audio_seek(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    position_ms: u64,
) -> Result<(), String> {
    let result = state.audio.seek(position_ms);
    if let Err(error) = &result {
        AudioEngine::emit_error(&app_handle, error.clone());
    }
    result
}

#[tauri::command]
pub fn audio_set_volume(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    volume: f32,
) -> Result<(), String> {
    let applied_volume = state.audio.set_volume(volume)?;
    state
        .db
        .set_setting("volume", &applied_volume.to_string())
        .map_err(|error| {
            AudioEngine::emit_error(&app_handle, error.clone());
            error
        })?;

    Ok(())
}

#[tauri::command]
pub fn audio_clear_decoded_cache(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let result = state.audio.clear_decoded_cache();
    if let Err(error) = &result {
        AudioEngine::emit_error(&app_handle, error.clone());
    }
    result
}

// ── Play History Commands ────────────────────────────────────

#[tauri::command]
pub fn history_record_start(
    state: State<'_, AppState>,
    id: String,
    song_id: String,
) -> Result<(), String> {
    state.db.history_record_start(&id, &song_id)
}

#[tauri::command]
pub fn history_record_end(
    state: State<'_, AppState>,
    id: String,
    duration_played_ms: i64,
    completed: bool,
) -> Result<(), String> {
    state
        .db
        .history_record_end(&id, duration_played_ms, completed)
}

#[tauri::command]
pub fn history_record_skip(state: State<'_, AppState>, song_id: String) -> Result<(), String> {
    state.db.history_record_skip(&song_id)
}

#[tauri::command]
pub fn history_get_page(
    state: State<'_, AppState>,
    limit: i64,
    offset: i64,
) -> Result<PlayHistoryPage, String> {
    state.db.history_get_page(limit, offset)
}

// ── Stats Commands ───────────────────────────────────────────

#[tauri::command]
pub fn stats_get_dashboard(
    state: State<'_, AppState>,
    period_days: Option<i64>,
) -> Result<DashboardStats, String> {
    state.db.stats_get_dashboard(period_days)
}

// ── Export Commands ──────────────────────────────────────────

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
        playlists: &[db::ExportHierarchyPlaylist],
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

// ── Media Controls Commands ─────────────────────────────────

#[tauri::command]
pub fn media_controls_update(
    state: State<'_, AppState>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
    playing: bool,
) -> Result<(), String> {
    state.media_controls.update_metadata(
        title.as_deref(),
        artist.as_deref(),
        album.as_deref(),
        duration_ms,
    );
    state.media_controls.set_playing(playing);
    Ok(())
}
