use crate::db::{
    AlbumListItem, ArtistListItem, LibrarySearchResult, SearchPaletteResult, SongListItem,
};
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
    let folder_for_scan = folder.clone();

    tauri::async_runtime::spawn_blocking(move || {
        library::scan_library(&app_handle, &db, &folder_for_scan)
    })
    .await
    .map_err(|error| format!("scan task failed: {error}"))??;

    state.library_watcher.watch_root(folder.clone())?;

    let mut roots = state.db.get_library_roots()?;
    let canonical_folder = std::fs::canonicalize(&folder).unwrap_or(folder);
    let folder_key = canonical_folder.to_string_lossy().to_string();
    if !roots.contains(&folder_key) {
        roots.push(folder_key);
        state.db.set_library_roots(&roots)?;
    }

    Ok(())
}

#[tauri::command]
pub fn library_get_song_count(
    state: State<'_, AppState>,
    tag_ids: Option<Vec<String>>,
) -> Result<i64, String> {
    state
        .db
        .get_song_count(tag_ids.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn library_get_songs(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
    tag_ids: Option<Vec<String>>,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_songs(
        limit,
        offset,
        &sort,
        &order,
        tag_ids.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn library_get_sorted_song_ids(
    state: State<'_, AppState>,
    sort: String,
    order: String,
    tag_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    state.db.get_sorted_song_ids(
        &sort,
        &order,
        tag_ids.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub fn library_get_songs_by_ids(
    state: State<'_, AppState>,
    song_ids: Vec<String>,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_songs_by_ids(&song_ids)
}

#[tauri::command]
pub fn library_get_albums(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
) -> Result<Vec<AlbumListItem>, String> {
    state.db.get_albums(limit, offset, &sort, &order)
}

#[tauri::command]
pub fn library_get_album_tracks(
    state: State<'_, AppState>,
    album: String,
    album_artist: String,
) -> Result<Vec<SongListItem>, String> {
    state.db.get_album_tracks(&album, &album_artist)
}

#[tauri::command]
pub fn library_get_artists(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
    sort: String,
    order: String,
) -> Result<Vec<ArtistListItem>, String> {
    state.db.get_artists(limit, offset, &sort, &order)
}

#[tauri::command]
pub fn library_get_artist_albums(
    state: State<'_, AppState>,
    artist: String,
) -> Result<Vec<AlbumListItem>, String> {
    state.db.get_artist_albums(&artist)
}

#[tauri::command]
pub async fn library_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    tag_ids: Option<Vec<String>>,
) -> Result<LibrarySearchResult, String> {
    let db = state.db.clone();
    let limit = limit.unwrap_or(25);
    let tag_ids = tag_ids.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || db.search_library(&query, limit, &tag_ids))
        .await
        .map_err(|error| format!("search task failed: {error}"))?
}

#[tauri::command]
pub async fn search_palette(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
    tag_ids: Option<Vec<String>>,
) -> Result<SearchPaletteResult, String> {
    let db = state.db.clone();
    let limit = limit.unwrap_or(30);
    let tag_ids = tag_ids.unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || db.search_palette(&query, limit, &tag_ids))
        .await
        .map_err(|error| format!("search palette task failed: {error}"))?
}

#[tauri::command]
pub fn song_update_comment(
    state: State<'_, AppState>,
    song_id: String,
    comment: Option<String>,
) -> Result<(), String> {
    state.db.song_update_comment(&song_id, comment.as_deref())
}

#[tauri::command]
pub fn song_set_custom_start(
    state: State<'_, AppState>,
    song_id: String,
    custom_start_ms: i64,
) -> Result<(), String> {
    state.db.song_set_custom_start(&song_id, custom_start_ms)
}
