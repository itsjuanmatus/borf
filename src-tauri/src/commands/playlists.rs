use crate::db::{PlaylistMutationResult, PlaylistNode, PlaylistTrackItem};
use crate::state::AppState;
use tauri::State;

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
