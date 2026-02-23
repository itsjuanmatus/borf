export type SongSortField = "title" | "artist" | "album" | "date_added";
export type SortOrder = "asc" | "desc";

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
