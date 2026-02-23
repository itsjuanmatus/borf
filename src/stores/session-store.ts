import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AlbumSortField,
  ArtistSortField,
  LibraryView,
  QueueState,
  SongSortField,
  SortOrder,
} from "../types";

interface SessionState {
  volume: number;
  sidebarSize: number;
  activeView: LibraryView;
  queueSongIds: string[];
  queueCurrentIndex: number | null;
  repeatAll: boolean;
  songSort: SongSortField;
  songOrder: SortOrder;
  albumSort: AlbumSortField;
  albumOrder: SortOrder;
  artistSort: ArtistSortField;
  artistOrder: SortOrder;
  setVolume: (volume: number) => void;
  setSidebarSize: (size: number) => void;
  setActiveView: (activeView: LibraryView) => void;
  setQueueState: (queueState: QueueState) => void;
  setRepeatAll: (repeatAll: boolean) => void;
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
      queueSongIds: [],
      queueCurrentIndex: null,
      repeatAll: false,
      songSort: "title",
      songOrder: "asc",
      albumSort: "name",
      albumOrder: "asc",
      artistSort: "name",
      artistOrder: "asc",
      setVolume: (volume) => set({ volume }),
      setSidebarSize: (sidebarSize) => set({ sidebarSize }),
      setActiveView: (activeView) => set({ activeView }),
      setQueueState: (queueState) =>
        set({ queueSongIds: queueState.songIds, queueCurrentIndex: queueState.currentIndex }),
      setRepeatAll: (repeatAll) => set({ repeatAll }),
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
        queueSongIds: state.queueSongIds,
        queueCurrentIndex: state.queueCurrentIndex,
        repeatAll: state.repeatAll,
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
