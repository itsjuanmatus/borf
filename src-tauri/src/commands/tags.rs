use crate::db::{PlaylistMutationResult, SongListItem, Tag};
use crate::state::AppState;
use tauri::State;

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
