use crate::imports::itunes::{self, ItunesImportOptions, ItunesImportSummary, ItunesPreview};
use crate::state::AppState;
use std::path::Path;
use tauri::{AppHandle, State};

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
