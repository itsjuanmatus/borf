use crate::audio::AudioEngine;
use crate::db::SongListItem;
use crate::library;
use crate::state::AppState;
use std::path::PathBuf;
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
