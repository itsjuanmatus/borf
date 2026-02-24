use crate::db::PlayHistoryPage;
use crate::state::AppState;
use tauri::State;

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
