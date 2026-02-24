use crate::state::AppState;
use tauri::State;

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
