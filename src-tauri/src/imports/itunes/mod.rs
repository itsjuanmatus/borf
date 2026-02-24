mod matcher;
mod parser;
mod progress;
mod types;

#[allow(unused_imports)]
pub use types::{
    ItunesImportOptions, ItunesImportProgressEvent, ItunesImportSummary, ItunesPreview,
};

use crate::db::{Database, ItunesSongDbUpdate, PlaylistImportData};
use matcher::{build_match_context, match_track};
use parser::parse_itunes_library;
use progress::{emit_progress, playlist_preview_counts};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

pub fn preview_itunes_import(db: &Database, xml_path: &Path) -> Result<ItunesPreview, String> {
    let parsed = parse_itunes_library(xml_path)?;
    let match_context = build_match_context(&db.get_song_match_candidates()?);

    let mut matched = 0_usize;
    let mut unmatched = 0_usize;

    for track in &parsed.tracks {
        if match_track(track, &match_context).matched_song_id.is_some() {
            matched += 1;
        } else {
            unmatched += 1;
        }
    }

    let (playlists_found, skipped_smart_playlists, skipped_system_playlists) =
        playlist_preview_counts(&parsed.playlists);

    Ok(ItunesPreview {
        tracks_found: parsed.tracks.len(),
        playlists_found,
        matched_tracks: matched,
        unmatched_tracks: unmatched,
        skipped_smart_playlists,
        skipped_system_playlists,
    })
}

pub fn run_itunes_import(
    app_handle: &AppHandle,
    db: &Database,
    xml_path: &Path,
    options: ItunesImportOptions,
) -> Result<ItunesImportSummary, String> {
    emit_progress(
        app_handle,
        "parsing",
        0,
        1,
        0,
        0,
        Some(String::from("Reading iTunes Library.xml")),
    );

    let parsed = parse_itunes_library(xml_path)?;
    let match_context = build_match_context(&db.get_song_match_candidates()?);

    emit_progress(app_handle, "matching", 0, parsed.tracks.len(), 0, 0, None);

    let mut matched_track_ids_by_itunes_track_id = HashMap::new();
    let mut updates = Vec::<ItunesSongDbUpdate>::new();
    let mut matched_tracks = 0_usize;
    let mut unmatched_tracks = 0_usize;

    for (index, track) in parsed.tracks.iter().enumerate() {
        let match_result = match_track(track, &match_context);

        if let Some(song_id) = match_result.matched_song_id {
            matched_track_ids_by_itunes_track_id.insert(track.track_id, song_id);
            matched_tracks += 1;
        } else {
            unmatched_tracks += 1;
        }

        if let Some(update) = match_result.update {
            updates.push(update);
        }

        if index == parsed.tracks.len().saturating_sub(1) || index % 250 == 0 {
            emit_progress(
                app_handle,
                "matching",
                index + 1,
                parsed.tracks.len(),
                matched_tracks,
                unmatched_tracks,
                Some(track.title.clone()),
            );
        }
    }

    let mut playlist_imports = Vec::<PlaylistImportData>::new();
    let mut playlists_found = 0_usize;
    let mut skipped_smart_playlists = 0_usize;
    let mut skipped_system_playlists = 0_usize;

    if options.import_playlists {
        emit_progress(
            app_handle,
            "playlist-prep",
            0,
            parsed.playlists.len(),
            matched_tracks,
            unmatched_tracks,
            None,
        );

        for (index, playlist) in parsed.playlists.iter().enumerate() {
            if playlist.is_smart {
                skipped_smart_playlists += 1;
                continue;
            }
            if playlist.is_system {
                skipped_system_playlists += 1;
                continue;
            }

            playlists_found += 1;
            let mut matched_song_ids = Vec::new();
            if !playlist.is_folder {
                for track_id in &playlist.track_ids {
                    if let Some(song_id) = matched_track_ids_by_itunes_track_id.get(track_id) {
                        matched_song_ids.push(song_id.clone());
                    }
                }
            }

            playlist_imports.push(PlaylistImportData {
                external_id: playlist.external_id.clone(),
                parent_external_id: playlist.parent_external_id.clone(),
                name: playlist.name.clone(),
                is_folder: playlist.is_folder,
                sort_order: playlist.sort_order,
                song_ids: matched_song_ids,
            });

            if index == parsed.playlists.len().saturating_sub(1) || index % 100 == 0 {
                emit_progress(
                    app_handle,
                    "playlist-prep",
                    index + 1,
                    parsed.playlists.len(),
                    matched_tracks,
                    unmatched_tracks,
                    Some(playlist.name.clone()),
                );
            }
        }
    } else {
        let (found, smart, system) = playlist_preview_counts(&parsed.playlists);
        playlists_found = found;
        skipped_smart_playlists = smart;
        skipped_system_playlists = system;
    }

    emit_progress(
        app_handle,
        "database",
        0,
        updates.len().max(1),
        matched_tracks,
        unmatched_tracks,
        Some(String::from("Writing import results")),
    );

    db.apply_itunes_import(
        &updates,
        options.import_play_counts,
        options.import_ratings,
        options.import_comments,
        &playlist_imports,
    )?;

    emit_progress(
        app_handle,
        "complete",
        1,
        1,
        matched_tracks,
        unmatched_tracks,
        Some(String::from("iTunes import complete")),
    );

    Ok(ItunesImportSummary {
        tracks_found: parsed.tracks.len(),
        playlists_found,
        matched_tracks,
        unmatched_tracks,
        imported_song_updates: updates.len(),
        imported_playlists: playlist_imports.len(),
        skipped_smart_playlists,
        skipped_system_playlists,
    })
}

#[cfg(test)]
mod tests;
