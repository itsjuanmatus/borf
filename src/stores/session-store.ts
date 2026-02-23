import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AlbumSortField,
  ArtistSortField,
  LibraryView,
  QueueState,
  RepeatMode,
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
  albumSort: AlbumSortField;
  albumOrder: SortOrder;
  artistSort: ArtistSortField;
  artistOrder: SortOrder;
  setVolume: (volume: number) => void;
  setSidebarSize: (size: number) => void;
  setActiveView: (activeView: LibraryView) => void;
  setActivePlaylistId: (playlistId: string | null) => void;
  setQueueState: (queueState: QueueState) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffleEnabled: (enabled: boolean) => void;
  setSongSort: (sort: SongSortField, order: SortOrder) => void;
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
      setRepeatMode: (repeatMode) => set({ repeatMode }),
      setShuffleEnabled: (shuffleEnabled) => set({ shuffleEnabled }),
      setSongSort: (songSort, songOrder) => set({ songSort, songOrder }),
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
        albumSort: state.albumSort,
        albumOrder: state.albumOrder,
        artistSort: state.artistSort,
        artistOrder: state.artistOrder,
      }),
    },
  ),
);
