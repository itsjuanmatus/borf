use crate::audio::AudioEngine;
use crate::db::{
    AlbumListItem, ArtistListItem, LibrarySearchResult, PlaylistMutationResult, PlaylistNode,
    PlaylistTrackItem, SongListItem, Tag,
};
use crate::imports::itunes::{self, ItunesImportOptions, ItunesImportSummary, ItunesPreview};
use crate::library;
use crate::state::AppState;
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
pub fn library_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    tag_ids: Option<Vec<String>>,
) -> Result<LibrarySearchResult, String> {
    state.db.search_library(
        &query,
        limit.unwrap_or(25),
        tag_ids.as_deref().unwrap_or_default(),
    )
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
    state.db.playlist_get_tracks_page(&playlist_id, limit, offset)
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
