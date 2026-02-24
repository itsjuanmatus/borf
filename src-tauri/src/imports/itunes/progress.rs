use super::types::{ItunesImportProgressEvent, ParsedPlaylist};
use tauri::{AppHandle, Emitter};

pub(super) fn emit_progress(
    app_handle: &AppHandle,
    stage: &str,
    processed: usize,
    total: usize,
    matched: usize,
    unmatched: usize,
    current_item: Option<String>,
) {
    let _ = app_handle.emit(
        "import:itunes-progress",
        ItunesImportProgressEvent {
            stage: String::from(stage),
            processed,
            total,
            matched,
            unmatched,
            current_item,
        },
    );
}

pub(super) fn playlist_preview_counts(playlists: &[ParsedPlaylist]) -> (usize, usize, usize) {
    let mut found = 0_usize;
    let mut smart = 0_usize;
    let mut system = 0_usize;

    for playlist in playlists {
        if playlist.is_smart {
            smart += 1;
            continue;
        }
        if playlist.is_system {
            system += 1;
            continue;
        }
        found += 1;
    }

    (found, smart, system)
}
