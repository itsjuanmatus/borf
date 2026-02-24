use crate::db::ItunesSongDbUpdate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct ItunesImportOptions {
    #[serde(default = "default_true")]
    pub import_play_counts: bool,
    #[serde(default = "default_true")]
    pub import_ratings: bool,
    #[serde(default = "default_true")]
    pub import_comments: bool,
    #[serde(default = "default_true")]
    pub import_playlists: bool,
}

impl Default for ItunesImportOptions {
    fn default() -> Self {
        Self {
            import_play_counts: true,
            import_ratings: true,
            import_comments: true,
            import_playlists: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesPreview {
    pub tracks_found: usize,
    pub playlists_found: usize,
    pub matched_tracks: usize,
    pub unmatched_tracks: usize,
    pub skipped_smart_playlists: usize,
    pub skipped_system_playlists: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesImportSummary {
    pub tracks_found: usize,
    pub playlists_found: usize,
    pub matched_tracks: usize,
    pub unmatched_tracks: usize,
    pub imported_song_updates: usize,
    pub imported_playlists: usize,
    pub skipped_smart_playlists: usize,
    pub skipped_system_playlists: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItunesImportProgressEvent {
    pub stage: String,
    pub processed: usize,
    pub total: usize,
    pub matched: usize,
    pub unmatched: usize,
    pub current_item: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ParsedTrack {
    pub(super) track_id: i64,
    pub(super) title: String,
    pub(super) artist: String,
    pub(super) duration_ms: Option<i64>,
    pub(super) location: Option<String>,
    pub(super) play_count: Option<i64>,
    pub(super) skip_count: Option<i64>,
    pub(super) rating: Option<i64>,
    pub(super) rating_computed: bool,
    pub(super) comments: Option<String>,
    pub(super) date_added: Option<String>,
    pub(super) play_date_utc: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ParsedPlaylist {
    pub(super) external_id: String,
    pub(super) parent_external_id: Option<String>,
    pub(super) name: String,
    pub(super) is_folder: bool,
    pub(super) sort_order: i64,
    pub(super) is_smart: bool,
    pub(super) is_system: bool,
    pub(super) track_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct ParsedLibrary {
    pub(super) tracks: Vec<ParsedTrack>,
    pub(super) playlists: Vec<ParsedPlaylist>,
}

#[derive(Debug, Clone)]
pub(super) struct MatchContext {
    pub(super) by_normalized_path: HashMap<String, String>,
    pub(super) by_signature: HashMap<String, Vec<DurationMatchCandidate>>,
}

#[derive(Debug, Clone)]
pub(super) struct DurationMatchCandidate {
    pub(super) song_id: String,
    pub(super) duration_ms: i64,
}

#[derive(Debug, Clone)]
pub(super) struct TrackMatchResult {
    pub(super) matched_song_id: Option<String>,
    pub(super) update: Option<ItunesSongDbUpdate>,
}

fn default_true() -> bool {
    true
}
