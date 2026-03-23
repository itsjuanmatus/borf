#[tauri::command]
pub fn app_request_restart(app: tauri::AppHandle) {
    app.request_restart();
}
