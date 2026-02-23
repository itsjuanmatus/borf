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
  SongListItem,
  SongSortField,
  SortOrder,
} from "../types";

export const libraryApi = {
  scan(folderPath: string) {
    return invoke<void>("library_scan", { folderPath });
  },
  getSongCount() {
    return invoke<number>("library_get_song_count");
  },
  getSongs(params: { limit: number; offset: number; sort: SongSortField; order: SortOrder }) {
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
  search(query: string, limit = 25) {
    return invoke<LibrarySearchResult>("library_search", { query, limit });
  },
  importItunesPreview(xmlPath: string) {
    return invoke<ItunesPreview>("import_itunes_preview", { xmlPath });
  },
  importItunes(xmlPath: string, options: ItunesImportOptions) {
    return invoke<ItunesImportSummary>("import_itunes", { xmlPath, options });
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
