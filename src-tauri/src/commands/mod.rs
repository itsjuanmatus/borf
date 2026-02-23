use crate::audio::AudioEngine;
use crate::db::{AlbumListItem, ArtistListItem, LibrarySearchResult, SongListItem};
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

    tauri::async_runtime::spawn_blocking(move || library::scan_library(&app_handle, &db, &folder))
        .await
        .map_err(|error| format!("scan task failed: {error}"))?
}

#[tauri::command]
pub fn library_get_song_count(state: State<'_, AppState>) -> Result<i64, String> {
    state.db.get_song_count()
}

#[tauri::command]
pub fn library_get_songs(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_songs(limit, offset, &sort, &order)
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
) -> Result<LibrarySearchResult, String> {
    state.db.search_library(&query, limit.unwrap_or(25))
}

#[tauri::command]
pub async fn import_itunes_preview(
    state: State<'_, AppState>,
    xml_path: String,
) -> Result<ItunesPreview, String> {
    let db = state.db.clone();

    tauri::async_runtime::spawn_blocking(move || itunes::preview_itunes_import(&db, Path::new(&xml_path)))
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
