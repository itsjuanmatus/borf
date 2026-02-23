import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumListItem,
  AlbumSortField,
  ArtistListItem,
  ArtistSortField,
  ItunesImportOptions,
  ItunesImportSummary,
  ItunesPreview,
  LibrarySearchResult,
  PlaylistMutationResult,
  PlaylistNode,
  PlaylistTrackItem,
  SongListItem,
  SongSortField,
  SortOrder,
  Tag,
} from "../types";

export const libraryApi = {
  scan(folderPath: string) {
    return invoke<void>("library_scan", { folderPath });
  },
  getSongCount(tagIds?: string[]) {
    return invoke<number>("library_get_song_count", { tagIds: tagIds ?? null });
  },
  getSongs(params: {
    limit: number;
    offset: number;
    sort: SongSortField;
    order: SortOrder;
    tagIds?: string[];
  }) {
    return invoke<SongListItem[]>("library_get_songs", params);
  },
  getSongsByIds(songIds: string[]) {
    return invoke<SongListItem[]>("library_get_songs_by_ids", { songIds });
  },
  getAlbums(params: { limit: number; offset: number; sort: AlbumSortField; order: SortOrder }) {
    return invoke<AlbumListItem[]>("library_get_albums", params);
  },
  getAlbumTracks(params: { album: string; albumArtist: string }) {
    return invoke<SongListItem[]>("library_get_album_tracks", params);
  },
  getArtists(params: { limit: number; offset: number; sort: ArtistSortField; order: SortOrder }) {
    return invoke<ArtistListItem[]>("library_get_artists", params);
  },
  getArtistAlbums(artist: string) {
    return invoke<AlbumListItem[]>("library_get_artist_albums", { artist });
  },
  search(query: string, limit = 25, tagIds?: string[]) {
    return invoke<LibrarySearchResult>("library_search", { query, limit, tagIds: tagIds ?? null });
  },
  updateSongComment(songId: string, comment: string | null) {
    return invoke<void>("song_update_comment", { songId, comment });
  },
  setSongCustomStart(songId: string, customStartMs: number) {
    return invoke<void>("song_set_custom_start", { songId, customStartMs });
  },
  importItunesPreview(xmlPath: string) {
    return invoke<ItunesPreview>("import_itunes_preview", { xmlPath });
  },
  importItunes(xmlPath: string, options: ItunesImportOptions) {
    return invoke<ItunesImportSummary>("import_itunes", { xmlPath, options });
  },
};

export const tagsApi = {
  list() {
    return invoke<Tag[]>("tags_list");
  },
  create(name: string, color: string) {
    return invoke<Tag>("tags_create", { name, color });
  },
  rename(id: string, name: string) {
    return invoke<Tag>("tags_rename", { id, name });
  },
  setColor(id: string, color: string) {
    return invoke<Tag>("tags_set_color", { id, color });
  },
  delete(id: string) {
    return invoke<void>("tags_delete", { id });
  },
  assign(songIds: string[], tagIds: string[]) {
    return invoke<PlaylistMutationResult>("tags_assign", { songIds, tagIds });
  },
  remove(songIds: string[], tagIds: string[]) {
    return invoke<PlaylistMutationResult>("tags_remove", { songIds, tagIds });
  },
  getSongsByTag(tagIds: string[]) {
    return invoke<SongListItem[]>("tags_get_songs_by_tag", { tagIds });
  },
};

export const audioApi = {
  play(songId: string, startMs?: number) {
    return invoke<void>("audio_play", { songId, startMs });
  },
  pause() {
    return invoke<void>("audio_pause");
  },
  resume() {
    return invoke<void>("audio_resume");
  },
  seek(positionMs: number) {
    return invoke<void>("audio_seek", { positionMs });
  },
  setVolume(volume: number) {
    return invoke<void>("audio_set_volume", { volume });
  },
};

export const playlistApi = {
  list() {
    return invoke<PlaylistNode[]>("playlist_list");
  },
  create(params: { name: string; parentId?: string | null; isFolder: boolean }) {
    return invoke<PlaylistNode>("playlist_create", {
      name: params.name,
      parentId: params.parentId ?? null,
      isFolder: params.isFolder,
    });
  },
  rename(id: string, name: string) {
    return invoke<PlaylistNode>("playlist_rename", { id, name });
  },
  delete(id: string) {
    return invoke<void>("playlist_delete", { id });
  },
  duplicate(id: string) {
    return invoke<PlaylistNode>("playlist_duplicate", { id });
  },
  move(params: { id: string; newParentId?: string | null; newIndex: number }) {
    return invoke<void>("playlist_move", {
      id: params.id,
      newParentId: params.newParentId ?? null,
      newIndex: params.newIndex,
    });
  },
  getTracks(playlistId: string) {
    return invoke<PlaylistTrackItem[]>("playlist_get_tracks", { playlistId });
  },
  addSongs(params: { playlistId: string; songIds: string[]; insertIndex?: number | null }) {
    return invoke<PlaylistMutationResult>("playlist_add_songs", {
      playlistId: params.playlistId,
      songIds: params.songIds,
      insertIndex: params.insertIndex ?? null,
    });
  },
  removeSongs(playlistId: string, songIds: string[]) {
    return invoke<PlaylistMutationResult>("playlist_remove_songs", { playlistId, songIds });
  },
  reorderTracks(playlistId: string, orderedSongIds: string[]) {
    return invoke<void>("playlist_reorder_tracks", { playlistId, orderedSongIds });
  },
};
