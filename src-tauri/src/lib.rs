mod audio;
mod commands;
mod db;
mod library;
mod state;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let database =
                Arc::new(db::Database::new(&app_handle).expect("failed to initialize database"));
            let initial_volume = database
                .get_volume()
                .expect("failed to resolve initial volume");
            let audio = Arc::new(
                audio::AudioEngine::new(app_handle, initial_volume)
                    .expect("failed to initialize audio engine"),
            );

            app.manage(state::AppState::new(database, audio));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_scan,
            commands::library_get_songs,
            commands::audio_play,
            commands::audio_pause,
            commands::audio_resume,
            commands::audio_seek,
            commands::audio_set_volume,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
