import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_SONG_COLUMN_ORDER,
  DEFAULT_VISIBLE_SONG_COLUMNS,
  normalizeSongColumnOrder,
  normalizeSongVisibleColumns,
} from "../lib/song-columns";
import type {
  AlbumSortField,
  ArtistSortField,
  LibraryView,
  QueueState,
  RepeatMode,
  SongOptionalColumnKey,
  SongSortField,
  SortOrder,
} from "../types";

interface SessionState {
  volume: number;
  sidebarSize: number;
  activeView: LibraryView;
  activePlaylistId: string | null;
  queueSongIds: string[];
  queueCurrentIndex: number | null;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  songSort: SongSortField;
  songOrder: SortOrder;
  songColumnOrder: SongOptionalColumnKey[];
  songVisibleColumns: SongOptionalColumnKey[];
  albumSort: AlbumSortField;
  albumOrder: SortOrder;
  artistSort: ArtistSortField;
  artistOrder: SortOrder;
  setVolume: (volume: number) => void;
  setSidebarSize: (size: number) => void;
  setActiveView: (activeView: LibraryView) => void;
  setActivePlaylistId: (playlistId: string | null) => void;
  setQueueState: (queueState: QueueState) => void;
  setQueueSongIds: (songIds: string[]) => void;
  setQueueCurrentIndex: (currentIndex: number | null) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleEnabled: (enabled: boolean) => void;
  setSongSort: (sort: SongSortField, order: SortOrder) => void;
  setSongColumnOrder: (columns: SongOptionalColumnKey[]) => void;
  setSongVisibleColumns: (columns: SongOptionalColumnKey[]) => void;
  setAlbumSort: (sort: AlbumSortField, order: SortOrder) => void;
  setArtistSort: (sort: ArtistSortField, order: SortOrder) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      volume: 0.8,
      sidebarSize: 22,
      activeView: "songs",
      activePlaylistId: null,
      queueSongIds: [],
      queueCurrentIndex: null,
      repeatMode: "off",
      shuffleEnabled: false,
      songSort: "title",
      songOrder: "asc",
      songColumnOrder: [...DEFAULT_SONG_COLUMN_ORDER],
      songVisibleColumns: [...DEFAULT_VISIBLE_SONG_COLUMNS],
      albumSort: "name",
      albumOrder: "asc",
      artistSort: "name",
      artistOrder: "asc",
      setVolume: (volume) => set({ volume }),
      setSidebarSize: (sidebarSize) => set({ sidebarSize }),
      setActiveView: (activeView) => set({ activeView }),
      setActivePlaylistId: (activePlaylistId) => set({ activePlaylistId }),
      setQueueState: (queueState) =>
        set({
          queueSongIds: queueState.songIds,
          queueCurrentIndex: queueState.currentIndex,
          repeatMode: queueState.repeatMode,
        }),
      setQueueSongIds: (queueSongIds) => set({ queueSongIds }),
      setQueueCurrentIndex: (queueCurrentIndex) => set({ queueCurrentIndex }),
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setShuffleEnabled: (shuffleEnabled) => set({ shuffleEnabled }),
      setSongSort: (songSort, songOrder) => set({ songSort, songOrder }),
      setSongColumnOrder: (songColumnOrder) =>
        set({
          songColumnOrder: normalizeSongColumnOrder(songColumnOrder),
        }),
      setSongVisibleColumns: (songVisibleColumns) =>
        set({
          songVisibleColumns: normalizeSongVisibleColumns(songVisibleColumns),
        }),
      setAlbumSort: (albumSort, albumOrder) => set({ albumSort, albumOrder }),
      setArtistSort: (artistSort, artistOrder) => set({ artistSort, artistOrder }),
    }),
    {
      name: "borf-session",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        volume: state.volume,
        sidebarSize: state.sidebarSize,
        activeView: state.activeView,
        activePlaylistId: state.activePlaylistId,
        queueSongIds: state.queueSongIds,
        queueCurrentIndex: state.queueCurrentIndex,
        repeatMode: state.repeatMode,
        shuffleEnabled: state.shuffleEnabled,
        songSort: state.songSort,
        songOrder: state.songOrder,
        songColumnOrder: state.songColumnOrder,
        songVisibleColumns: state.songVisibleColumns,
        albumSort: state.albumSort,
        albumOrder: state.albumOrder,
        artistSort: state.artistSort,
        artistOrder: state.artistOrder,
      }),
    },
  ),
);
