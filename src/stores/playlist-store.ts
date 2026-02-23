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
  selectedSongIds: string[];
  lastSelectedSongIndex: number | null;
  clipboardSongIds: string[];
  setPlaylists: (playlists: PlaylistNode[]) => void;
  setPlaylistTracks: (playlistId: string, tracks: PlaylistTrackItem[]) => void;
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
    })),
  removePlaylist: (playlistId) =>
    set((state) => {
      const nextTracks = { ...state.tracksByPlaylistId };
      delete nextTracks[playlistId];
      return {
        tracksByPlaylistId: nextTracks,
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
