use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct DbSongUpsert {
    pub id: String,
    pub file_path: String,
    pub file_hash: Option<String>,
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub track_number: Option<i64>,
    pub disc_number: i64,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub duration_ms: i64,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub artwork_path: Option<String>,
    pub file_modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SongListItem {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub artwork_path: Option<String>,
    pub file_path: String,
    pub custom_start_ms: i64,
    pub play_count: i64,
    pub comment: Option<String>,
    pub tags: Vec<Tag>,
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlbumListItem {
    pub album: String,
    pub album_artist: String,
    pub song_count: i64,
    pub total_duration_ms: i64,
    pub artwork_path: Option<String>,
    pub year: Option<i64>,
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtistListItem {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub play_count: i64,
    pub artwork_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistSearchItem {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub parent_name: Option<String>,
    pub is_folder: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibrarySearchResult {
    pub songs: Vec<SongListItem>,
    pub albums: Vec<AlbumListItem>,
    pub artists: Vec<ArtistListItem>,
    pub playlists: Vec<PlaylistSearchItem>,
    pub folders: Vec<PlaylistSearchItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchPaletteAlbumRef {
    pub album: String,
    pub album_artist: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchPaletteItemKind {
    Song,
    Album,
    Artist,
    Playlist,
    Folder,
    Action,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchPaletteItem {
    pub kind: SearchPaletteItemKind,
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub score: f64,
    pub rank_reason: Option<String>,
    pub song: Option<SongListItem>,
    pub album: Option<SearchPaletteAlbumRef>,
    pub artist: Option<String>,
    pub playlist: Option<PlaylistSearchItem>,
    pub action_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchPaletteResult {
    pub items: Vec<SearchPaletteItem>,
    pub took_ms: f64,
}

#[derive(Debug, Clone)]
pub struct SongPlaybackInfo {
    pub id: String,
    pub duration_ms: i64,
    pub file_path: String,
    pub custom_start_ms: i64,
}

#[derive(Debug, Clone)]
pub struct SongMatchCandidate {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ItunesSongDbUpdate {
    pub song_id: String,
    pub play_count: Option<i64>,
    pub skip_count: Option<i64>,
    pub rating: Option<i64>,
    pub comment: Option<String>,
    pub date_added: Option<String>,
    pub last_played_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlaylistImportData {
    pub external_id: String,
    pub parent_external_id: Option<String>,
    pub name: String,
    pub is_folder: bool,
    pub sort_order: i64,
    pub song_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistNode {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub is_folder: bool,
    pub sort_order: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistTrackItem {
    pub playlist_id: String,
    pub position: i64,
    pub song: SongListItem,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistMutationResult {
    pub affected: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayHistoryEntry {
    pub id: String,
    pub song_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork_path: Option<String>,
    pub started_at: String,
    pub duration_played_ms: i64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayHistoryPage {
    pub entries: Vec<PlayHistoryEntry>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DashboardStats {
    pub period_days: Option<i64>,
    pub total_songs: i64,
    pub total_plays: i64,
    pub total_listen_ms: i64,
    pub longest_streak_days: i64,
    pub top_songs: Vec<TopSongStat>,
    pub top_artists: Vec<TopArtistStat>,
    pub top_albums: Vec<TopAlbumStat>,
    pub genre_breakdown: Vec<GenreStat>,
    pub listening_by_day: Vec<DayListenStat>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopSongStat {
    pub song_id: String,
    pub title: String,
    pub artist: String,
    pub artwork_path: Option<String>,
    pub play_count: i64,
    pub total_listen_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopArtistStat {
    pub artist: String,
    pub play_count: i64,
    pub total_listen_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopAlbumStat {
    pub album: String,
    pub album_artist: String,
    pub artwork_path: Option<String>,
    pub play_count: i64,
    pub total_listen_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GenreStat {
    pub genre: String,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayListenStat {
    pub date: String,
    pub total_listen_ms: i64,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportPlayStatRow {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub play_count: i64,
    pub total_listen_ms: i64,
    pub last_played: Option<String>,
    pub tags: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportTagRow {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportHierarchyPlaylist {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub is_folder: bool,
    pub sort_order: i64,
    pub tracks: Vec<ExportHierarchyTrack>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportHierarchyTrack {
    pub title: String,
    pub artist: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct LibraryRootsSetting {
    pub(super) roots: Vec<String>,
}
