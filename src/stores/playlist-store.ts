import { create } from "zustand";
import type { PlaylistNode, PlaylistTrackItem } from "../types";

interface SelectSongParams {
  songId: string;
  songIndex: number;
  orderedSongIds: string[];
  mode: "single" | "toggle" | "range";
}

interface PlaylistState {
  playlists: PlaylistNode[];
  tracksByPlaylistId: Record<string, PlaylistTrackItem[]>;
  trackCountsByPlaylistId: Record<string, number>;
  tracksPageByPlaylistId: Record<string, Record<number, PlaylistTrackItem[]>>;
  loadedPagesByPlaylistId: Record<string, number[]>;
  loadingPagesByPlaylistId: Record<string, number[]>;
  selectedSongIds: string[];
  lastSelectedSongIndex: number | null;
  clipboardSongIds: string[];
  setPlaylists: (playlists: PlaylistNode[]) => void;
  setPlaylistTracks: (playlistId: string, tracks: PlaylistTrackItem[]) => void;
  setPlaylistTrackCount: (playlistId: string, count: number) => void;
  setPlaylistTracksPage: (playlistId: string, page: number, tracks: PlaylistTrackItem[]) => void;
  setPlaylistPageLoading: (playlistId: string, page: number, loading: boolean) => void;
  invalidatePlaylistCache: (playlistId: string) => void;
  invalidatePlaylistsCache: (playlistIds: string[]) => void;
  removePlaylist: (playlistId: string) => void;
  selectSongs: (params: SelectSongParams) => void;
  clearSelection: () => void;
  copySelectionToClipboard: () => void;
  setClipboardSongIds: (songIds: string[]) => void;
  clearClipboard: () => void;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  tracksByPlaylistId: {},
  trackCountsByPlaylistId: {},
  tracksPageByPlaylistId: {},
  loadedPagesByPlaylistId: {},
  loadingPagesByPlaylistId: {},
  selectedSongIds: [],
  lastSelectedSongIndex: null,
  clipboardSongIds: [],
  setPlaylists: (playlists) => set({ playlists }),
  setPlaylistTracks: (playlistId, tracks) =>
    set((state) => ({
      tracksByPlaylistId: {
        ...state.tracksByPlaylistId,
        [playlistId]: tracks,
      },
      trackCountsByPlaylistId: {
        ...state.trackCountsByPlaylistId,
        [playlistId]: tracks.length,
      },
      tracksPageByPlaylistId: {
        ...state.tracksPageByPlaylistId,
        [playlistId]: {
          0: tracks,
        },
      },
      loadedPagesByPlaylistId: {
        ...state.loadedPagesByPlaylistId,
        [playlistId]: [0],
      },
    })),
  setPlaylistTrackCount: (playlistId, count) =>
    set((state) => ({
      trackCountsByPlaylistId: {
        ...state.trackCountsByPlaylistId,
        [playlistId]: count,
      },
    })),
  setPlaylistTracksPage: (playlistId, page, tracks) =>
    set((state) => {
      const nextPages = {
        ...(state.tracksPageByPlaylistId[playlistId] ?? {}),
        [page]: tracks,
      };
      const loadedPages = new Set(state.loadedPagesByPlaylistId[playlistId] ?? []);
      loadedPages.add(page);

      const mergedTracks = Array.from(loadedPages)
        .sort((left, right) => left - right)
        .flatMap((loadedPage) => nextPages[loadedPage] ?? []);

      return {
        tracksPageByPlaylistId: {
          ...state.tracksPageByPlaylistId,
          [playlistId]: nextPages,
        },
        loadedPagesByPlaylistId: {
          ...state.loadedPagesByPlaylistId,
          [playlistId]: Array.from(loadedPages).sort((left, right) => left - right),
        },
        loadingPagesByPlaylistId: {
          ...state.loadingPagesByPlaylistId,
          [playlistId]: (state.loadingPagesByPlaylistId[playlistId] ?? []).filter(
            (value) => value !== page,
          ),
        },
        tracksByPlaylistId: {
          ...state.tracksByPlaylistId,
          [playlistId]: mergedTracks,
        },
      };
    }),
  setPlaylistPageLoading: (playlistId, page, loading) =>
    set((state) => {
      const current = new Set(state.loadingPagesByPlaylistId[playlistId] ?? []);
      if (loading) {
        current.add(page);
      } else {
        current.delete(page);
      }
      return {
        loadingPagesByPlaylistId: {
          ...state.loadingPagesByPlaylistId,
          [playlistId]: Array.from(current).sort((left, right) => left - right),
        },
      };
    }),
  invalidatePlaylistCache: (playlistId) =>
    set((state) => {
      const nextTracks = { ...state.tracksByPlaylistId };
      const nextCounts = { ...state.trackCountsByPlaylistId };
      const nextPages = { ...state.tracksPageByPlaylistId };
      const nextLoaded = { ...state.loadedPagesByPlaylistId };
      const nextLoading = { ...state.loadingPagesByPlaylistId };
      delete nextTracks[playlistId];
      delete nextCounts[playlistId];
      delete nextPages[playlistId];
      delete nextLoaded[playlistId];
      delete nextLoading[playlistId];
      return {
        tracksByPlaylistId: nextTracks,
        trackCountsByPlaylistId: nextCounts,
        tracksPageByPlaylistId: nextPages,
        loadedPagesByPlaylistId: nextLoaded,
        loadingPagesByPlaylistId: nextLoading,
      };
    }),
  invalidatePlaylistsCache: (playlistIds) =>
    set((state) => {
      const ids = new Set(playlistIds);
      const nextTracks = { ...state.tracksByPlaylistId };
      const nextCounts = { ...state.trackCountsByPlaylistId };
      const nextPages = { ...state.tracksPageByPlaylistId };
      const nextLoaded = { ...state.loadedPagesByPlaylistId };
      const nextLoading = { ...state.loadingPagesByPlaylistId };
      for (const playlistId of ids) {
        delete nextTracks[playlistId];
        delete nextCounts[playlistId];
        delete nextPages[playlistId];
        delete nextLoaded[playlistId];
        delete nextLoading[playlistId];
      }
      return {
        tracksByPlaylistId: nextTracks,
        trackCountsByPlaylistId: nextCounts,
        tracksPageByPlaylistId: nextPages,
        loadedPagesByPlaylistId: nextLoaded,
        loadingPagesByPlaylistId: nextLoading,
      };
    }),
  removePlaylist: (playlistId) =>
    set((state) => {
      const nextTracks = { ...state.tracksByPlaylistId };
      const nextCounts = { ...state.trackCountsByPlaylistId };
      const nextPages = { ...state.tracksPageByPlaylistId };
      const nextLoaded = { ...state.loadedPagesByPlaylistId };
      const nextLoading = { ...state.loadingPagesByPlaylistId };
      delete nextTracks[playlistId];
      delete nextCounts[playlistId];
      delete nextPages[playlistId];
      delete nextLoaded[playlistId];
      delete nextLoading[playlistId];
      return {
        tracksByPlaylistId: nextTracks,
        trackCountsByPlaylistId: nextCounts,
        tracksPageByPlaylistId: nextPages,
        loadedPagesByPlaylistId: nextLoaded,
        loadingPagesByPlaylistId: nextLoading,
      };
    }),
  selectSongs: ({ songId, songIndex, orderedSongIds, mode }) =>
    set((state) => {
      if (mode === "single") {
        return {
          selectedSongIds: [songId],
          lastSelectedSongIndex: songIndex,
        };
      }

      if (mode === "toggle") {
        const isSelected = state.selectedSongIds.includes(songId);
        return {
          selectedSongIds: isSelected
            ? state.selectedSongIds.filter((value) => value !== songId)
            : [...state.selectedSongIds, songId],
          lastSelectedSongIndex: songIndex,
        };
      }

      const anchor = state.lastSelectedSongIndex ?? songIndex;
      const start = Math.min(anchor, songIndex);
      const end = Math.max(anchor, songIndex);
      const rangeIds = orderedSongIds.slice(start, end + 1);
      const existing = new Set(state.selectedSongIds);
      for (const rangeId of rangeIds) {
        existing.add(rangeId);
      }

      return {
        selectedSongIds: Array.from(existing),
        lastSelectedSongIndex: songIndex,
      };
    }),
  clearSelection: () => set({ selectedSongIds: [], lastSelectedSongIndex: null }),
  copySelectionToClipboard: () => {
    const selectedSongIds = get().selectedSongIds;
    set({ clipboardSongIds: selectedSongIds });
  },
  setClipboardSongIds: (songIds) => set({ clipboardSongIds: songIds }),
  clearClipboard: () => set({ clipboardSongIds: [] }),
}));
