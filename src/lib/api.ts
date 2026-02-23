import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumListItem,
  AlbumSortField,
  ArtistListItem,
  ArtistSortField,
  DashboardStats,
  ItunesImportOptions,
  ItunesImportSummary,
  ItunesPreview,
  LibrarySearchResult,
  PlayHistoryPage,
  PlaylistMutationResult,
  PlaylistNode,
  PlaylistTrackIdsResult,
  PlaylistTrackItem,
  PlaylistTrackPageResult,
  SongListItem,
  SongSortField,
  SortOrder,
  Tag,
} from "../types";

const PERF_TRACE_ENABLED = (() => {
  const rawValue = String(import.meta.env.VITE_PERF_TRACE ?? "").toLowerCase();
  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
})();

async function invokeWithPerf<T>(command: string, args?: Record<string, unknown>) {
  const start = PERF_TRACE_ENABLED ? performance.now() : 0;
  try {
    return await invoke<T>(command, args);
  } finally {
    if (PERF_TRACE_ENABLED) {
      const elapsedMs = performance.now() - start;
      console.debug(`[perf] tauri:${command} ${elapsedMs.toFixed(1)}ms`);
    }
  }
}

export const libraryApi = {
  scan(folderPath: string) {
    return invokeWithPerf<void>("library_scan", { folderPath });
  },
  getSongCount(tagIds?: string[]) {
    return invokeWithPerf<number>("library_get_song_count", { tagIds: tagIds ?? null });
  },
  getSongs(params: {
    limit: number;
    offset: number;
    sort: SongSortField;
    order: SortOrder;
    tagIds?: string[];
  }) {
    return invokeWithPerf<SongListItem[]>("library_get_songs", params);
  },
  getSongsByIds(songIds: string[]) {
    return invokeWithPerf<SongListItem[]>("library_get_songs_by_ids", { songIds });
  },
  getAlbums(params: { limit: number; offset: number; sort: AlbumSortField; order: SortOrder }) {
    return invokeWithPerf<AlbumListItem[]>("library_get_albums", params);
  },
  getAlbumTracks(params: { album: string; albumArtist: string }) {
    return invokeWithPerf<SongListItem[]>("library_get_album_tracks", params);
  },
  getArtists(params: { limit: number; offset: number; sort: ArtistSortField; order: SortOrder }) {
    return invokeWithPerf<ArtistListItem[]>("library_get_artists", params);
  },
  getArtistAlbums(artist: string) {
    return invokeWithPerf<AlbumListItem[]>("library_get_artist_albums", { artist });
  },
  search(query: string, limit = 25, tagIds?: string[]) {
    return invokeWithPerf<LibrarySearchResult>("library_search", {
      query,
      limit,
      tagIds: tagIds ?? null,
    });
  },
  updateSongComment(songId: string, comment: string | null) {
    return invokeWithPerf<void>("song_update_comment", { songId, comment });
  },
  setSongCustomStart(songId: string, customStartMs: number) {
    return invokeWithPerf<void>("song_set_custom_start", { songId, customStartMs });
  },
  importItunesPreview(xmlPath: string) {
    return invokeWithPerf<ItunesPreview>("import_itunes_preview", { xmlPath });
  },
  importItunes(xmlPath: string, options: ItunesImportOptions) {
    return invokeWithPerf<ItunesImportSummary>("import_itunes", { xmlPath, options });
  },
};

export const tagsApi = {
  list() {
    return invokeWithPerf<Tag[]>("tags_list");
  },
  create(name: string, color: string) {
    return invokeWithPerf<Tag>("tags_create", { name, color });
  },
  rename(id: string, name: string) {
    return invokeWithPerf<Tag>("tags_rename", { id, name });
  },
  setColor(id: string, color: string) {
    return invokeWithPerf<Tag>("tags_set_color", { id, color });
  },
  delete(id: string) {
    return invokeWithPerf<void>("tags_delete", { id });
  },
  assign(songIds: string[], tagIds: string[]) {
    return invokeWithPerf<PlaylistMutationResult>("tags_assign", { songIds, tagIds });
  },
  remove(songIds: string[], tagIds: string[]) {
    return invokeWithPerf<PlaylistMutationResult>("tags_remove", { songIds, tagIds });
  },
  getSongsByTag(tagIds: string[]) {
    return invokeWithPerf<SongListItem[]>("tags_get_songs_by_tag", { tagIds });
  },
};

export const audioApi = {
  play(songId: string, startMs?: number) {
    return invokeWithPerf<void>("audio_play", { songId, startMs });
  },
  pause() {
    return invokeWithPerf<void>("audio_pause");
  },
  resume() {
    return invokeWithPerf<void>("audio_resume");
  },
  seek(positionMs: number) {
    return invokeWithPerf<void>("audio_seek", { positionMs });
  },
  setVolume(volume: number) {
    return invokeWithPerf<void>("audio_set_volume", { volume });
  },
  clearDecodedCache() {
    return invokeWithPerf<void>("audio_clear_decoded_cache");
  },
};

export const playlistApi = {
  list() {
    return invokeWithPerf<PlaylistNode[]>("playlist_list");
  },
  create(params: { name: string; parentId?: string | null; isFolder: boolean }) {
    return invokeWithPerf<PlaylistNode>("playlist_create", {
      name: params.name,
      parentId: params.parentId ?? null,
      isFolder: params.isFolder,
    });
  },
  rename(id: string, name: string) {
    return invokeWithPerf<PlaylistNode>("playlist_rename", { id, name });
  },
  delete(id: string) {
    return invokeWithPerf<void>("playlist_delete", { id });
  },
  duplicate(id: string) {
    return invokeWithPerf<PlaylistNode>("playlist_duplicate", { id });
  },
  move(params: { id: string; newParentId?: string | null; newIndex: number }) {
    return invokeWithPerf<void>("playlist_move", {
      id: params.id,
      newParentId: params.newParentId ?? null,
      newIndex: params.newIndex,
    });
  },
  getTracks(playlistId: string) {
    return invokeWithPerf<PlaylistTrackItem[]>("playlist_get_tracks", { playlistId });
  },
  getTrackCount(playlistId: string) {
    return invokeWithPerf<number>("playlist_get_track_count", { playlistId });
  },
  async getTrackPage(params: {
    playlistId: string;
    limit: number;
    offset: number;
  }): Promise<PlaylistTrackPageResult> {
    const tracks = await invokeWithPerf<PlaylistTrackItem[]>("playlist_get_tracks_page", params);
    return {
      playlistId: params.playlistId,
      limit: params.limit,
      offset: params.offset,
      tracks,
    };
  },
  async getTrackIds(playlistId: string): Promise<PlaylistTrackIdsResult> {
    const songIds = await invokeWithPerf<string[]>("playlist_get_track_ids", { playlistId });
    return {
      playlistId,
      songIds,
    };
  },
  addSongs(params: { playlistId: string; songIds: string[]; insertIndex?: number | null }) {
    return invokeWithPerf<PlaylistMutationResult>("playlist_add_songs", {
      playlistId: params.playlistId,
      songIds: params.songIds,
      insertIndex: params.insertIndex ?? null,
    });
  },
  removeSongs(playlistId: string, songIds: string[]) {
    return invokeWithPerf<PlaylistMutationResult>("playlist_remove_songs", { playlistId, songIds });
  },
  reorderTracks(playlistId: string, orderedSongIds: string[]) {
    return invokeWithPerf<void>("playlist_reorder_tracks", { playlistId, orderedSongIds });
  },
};

export const historyApi = {
  recordStart(id: string, songId: string) {
    return invokeWithPerf<void>("history_record_start", { id, songId });
  },
  recordEnd(id: string, durationPlayedMs: number, completed: boolean) {
    return invokeWithPerf<void>("history_record_end", { id, durationPlayedMs, completed });
  },
  recordSkip(songId: string) {
    return invokeWithPerf<void>("history_record_skip", { songId });
  },
  getPage(limit: number, offset: number) {
    return invokeWithPerf<PlayHistoryPage>("history_get_page", { limit, offset });
  },
};

export const statsApi = {
  getDashboard(periodDays?: number | null) {
    return invokeWithPerf<DashboardStats>("stats_get_dashboard", {
      periodDays: periodDays ?? null,
    });
  },
};

export const exportApi = {
  playlistM3u8(playlistId: string, outputPath: string) {
    return invokeWithPerf<void>("export_playlist_m3u8", { playlistId, outputPath });
  },
  playStatsCsv(outputPath: string) {
    return invokeWithPerf<void>("export_play_stats_csv", { outputPath });
  },
  tagsCsv(outputPath: string) {
    return invokeWithPerf<void>("export_tags_csv", { outputPath });
  },
  libraryHierarchyMd(outputPath: string) {
    return invokeWithPerf<void>("export_library_hierarchy_md", { outputPath });
  },
};

export const mediaControlsApi = {
  update(params: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    durationMs?: number | null;
    playing: boolean;
  }) {
    return invokeWithPerf<void>("media_controls_update", {
      title: params.title ?? null,
      artist: params.artist ?? null,
      album: params.album ?? null,
      durationMs: params.durationMs ?? null,
      playing: params.playing,
    });
  },
};
