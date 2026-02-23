mod audio;
mod commands;
mod db;
mod imports;
mod library;
mod state;

use std::sync::Arc;
use tauri::menu::{Menu, SubmenuBuilder};
use tauri::{Emitter, Manager};

const MENU_ID_SCAN_MUSIC_FOLDER: &str = "library.scan_music_folder";
const MENU_ID_IMPORT_ITUNES_LIBRARY: &str = "library.import_itunes_library";

fn build_app_menu<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app_handle)?;
    let library_menu = SubmenuBuilder::new(app_handle, "Library")
        .text(MENU_ID_SCAN_MUSIC_FOLDER, "Scan Music Folder...")
        .text(MENU_ID_IMPORT_ITUNES_LIBRARY, "Import iTunes Library...")
        .build()?;
    menu.append(&library_menu)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == MENU_ID_SCAN_MUSIC_FOLDER {
                let _ = app.emit("menu:scan-music-folder", ());
            } else if event.id() == MENU_ID_IMPORT_ITUNES_LIBRARY {
                let _ = app.emit("menu:import-itunes-library", ());
            }
        })
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
            let library_watcher = Arc::new(
                library::LibraryWatcher::new(app.handle().clone(), database.clone())
                    .expect("failed to initialize library watcher"),
            );
            for root in database
                .get_library_roots()
                .expect("failed to resolve persisted library roots")
            {
                let _ = library_watcher.watch_root(std::path::PathBuf::from(root));
            }

            app.manage(state::AppState::new(database, audio, library_watcher));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_scan,
            commands::library_get_song_count,
            commands::library_get_songs,
            commands::library_get_songs_by_ids,
            commands::library_get_albums,
            commands::library_get_album_tracks,
            commands::library_get_artists,
            commands::library_get_artist_albums,
            commands::library_search,
            commands::tags_list,
            commands::tags_create,
            commands::tags_rename,
            commands::tags_set_color,
            commands::tags_delete,
            commands::tags_assign,
            commands::tags_remove,
            commands::tags_get_songs_by_tag,
            commands::song_update_comment,
            commands::song_set_custom_start,
            commands::playlist_list,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_delete,
            commands::playlist_duplicate,
            commands::playlist_move,
            commands::playlist_get_tracks,
            commands::playlist_get_track_count,
            commands::playlist_get_tracks_page,
            commands::playlist_get_track_ids,
            commands::playlist_add_songs,
            commands::playlist_remove_songs,
            commands::playlist_reorder_tracks,
            commands::import_itunes_preview,
            commands::import_itunes,
            commands::audio_play,
            commands::audio_pause,
            commands::audio_resume,
            commands::audio_seek,
            commands::audio_set_volume,
            commands::audio_clear_decoded_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
