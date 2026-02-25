export type SongSortField =
  | "title"
  | "artist"
  | "album"
  | "date_added"
  | "play_count"
  | "duration_ms";

export type SongOptionalColumnKey =
  | "artist"
  | "album"
  | "duration_ms"
  | "play_count"
  | "comment"
  | "date_added";

export type AlbumSortField = "name" | "artist" | "year" | "date_added";
export type ArtistSortField = "name" | "play_count";
export type SortOrder = "asc" | "desc";
export type LibraryView =
  | "songs"
  | "albums"
  | "artists"
  | "playlist"
  | "settings"
  | "history"
  | "stats";
export type RepeatMode = "off" | "all" | "one";
export type QueueRestoreMode = "lazy" | "full" | "minimal";

export type PlaybackState = "playing" | "paused" | "stopped";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface SongListItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  artwork_path: string | null;
  file_path: string;
  custom_start_ms: number;
  play_count: number;
  comment: string | null;
  tags: Tag[];
  date_added: string | null;
}

export interface AlbumListItem {
  album: string;
  album_artist: string;
  song_count: number;
  total_duration_ms: number;
  artwork_path: string | null;
  year: number | null;
  date_added: string | null;
}

export interface ArtistListItem {
  artist: string;
  song_count: number;
  album_count: number;
  play_count: number;
  artwork_path: string | null;
}

export interface PlaylistSearchItem {
  id: string;
  name: string;
  parent_id: string | null;
  parent_name: string | null;
  is_folder: boolean;
}

export interface LibrarySearchResult {
  songs: SongListItem[];
  albums: AlbumListItem[];
  artists: ArtistListItem[];
  playlists: PlaylistSearchItem[];
  folders: PlaylistSearchItem[];
}

export type SearchPaletteItemKind = "song" | "album" | "artist" | "playlist" | "folder" | "action";

export interface SearchPaletteAlbumRef {
  album: string;
  album_artist: string;
}

export interface SearchPaletteItem {
  kind: SearchPaletteItemKind;
  id: string;
  title: string;
  subtitle: string | null;
  score: number;
  rank_reason: string | null;
  song: SongListItem | null;
  album: SearchPaletteAlbumRef | null;
  artist: string | null;
  playlist: PlaylistSearchItem | null;
  action_id: string | null;
}

export interface SearchPaletteResult {
  items: SearchPaletteItem[];
  took_ms: number;
}

export interface QueueState {
  songIds: string[];
  currentIndex: number | null;
  repeatMode: RepeatMode;
}

export interface PlaylistNode {
  id: string;
  name: string;
  parent_id: string | null;
  is_folder: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PlaylistTrackItem {
  playlist_id: string;
  position: number;
  song: SongListItem;
}

export interface PlaylistTrackPageResult {
  playlistId: string;
  limit: number;
  offset: number;
  tracks: PlaylistTrackItem[];
}

export interface PlaylistTrackIdsResult {
  playlistId: string;
  songIds: string[];
}

export interface PlaylistMutationResult {
  affected: number;
}

export interface DragSongPayload {
  type: "song";
  songIds: string[];
  source: "library" | "search" | "playlist" | "queue";
  fromPlaylistId?: string;
}

export interface DragPlaylistPayload {
  type: "playlist-node";
  playlistId: string;
  isFolder: boolean;
}

export interface ScanProgressEvent {
  scanned: number;
  total: number;
  current_file: string;
}

export interface AudioStateEvent {
  state: PlaybackState;
}

export interface AudioPositionEvent {
  current_ms: number;
  duration_ms: number;
}

export interface AudioTrackEndedEvent {
  song_id: string;
  completed: boolean;
}

export interface AudioErrorEvent {
  message: string;
}

export interface LibraryFileChangedEvent {
  changed_paths: string[];
  reason: string;
  change_scope: "file" | "directory" | "bulk";
}

export interface PlayHistoryEntry {
  id: string;
  song_id: string;
  title: string;
  artist: string;
  album: string;
  artwork_path: string | null;
  started_at: string;
  duration_played_ms: number;
  completed: boolean;
}

export interface PlayHistoryPage {
  entries: PlayHistoryEntry[];
  total: number;
}

export interface DashboardStats {
  period_days: number | null;
  total_songs: number;
  total_plays: number;
  total_listen_ms: number;
  longest_streak_days: number;
  top_songs: TopSongStat[];
  top_artists: TopArtistStat[];
  top_albums: TopAlbumStat[];
  genre_breakdown: GenreStat[];
  listening_by_day: DayListenStat[];
}

export interface TopSongStat {
  song_id: string;
  title: string;
  artist: string;
  artwork_path: string | null;
  play_count: number;
  total_listen_ms: number;
}

export interface TopArtistStat {
  artist: string;
  play_count: number;
  total_listen_ms: number;
}

export interface TopAlbumStat {
  album: string;
  album_artist: string;
  artwork_path: string | null;
  play_count: number;
  total_listen_ms: number;
}

export interface GenreStat {
  genre: string;
  play_count: number;
}

export interface DayListenStat {
  date: string;
  total_listen_ms: number;
  play_count: number;
}

export interface ItunesPreview {
  tracks_found: number;
  playlists_found: number;
  matched_tracks: number;
  unmatched_tracks: number;
  skipped_smart_playlists: number;
  skipped_system_playlists: number;
}

export interface ItunesImportOptions {
  import_play_counts: boolean;
  import_ratings: boolean;
  import_comments: boolean;
  import_playlists: boolean;
}

export interface ItunesImportProgress {
  stage: string;
  processed: number;
  total: number;
  matched: number;
  unmatched: number;
  current_item: string | null;
}

export interface ItunesImportSummary {
  tracks_found: number;
  playlists_found: number;
  matched_tracks: number;
  unmatched_tracks: number;
  imported_song_updates: number;
  imported_playlists: number;
  skipped_smart_playlists: number;
  skipped_system_playlists: number;
}
