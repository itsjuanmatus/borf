export type SongSortField =
  | "title"
  | "artist"
  | "album"
  | "date_added"
  | "play_count"
  | "duration_ms";

export type AlbumSortField = "name" | "artist" | "year" | "date_added";
export type ArtistSortField = "name" | "play_count";
export type SortOrder = "asc" | "desc";
export type LibraryView = "songs" | "albums" | "artists";

export type PlaybackState = "playing" | "paused" | "stopped";

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

export interface LibrarySearchResult {
  songs: SongListItem[];
  albums: AlbumListItem[];
  artists: ArtistListItem[];
}

export interface QueueState {
  songIds: string[];
  currentIndex: number | null;
  repeatAll: boolean;
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
