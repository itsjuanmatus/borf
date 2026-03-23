import { create } from "zustand";
import type { SongListItem } from "../types";

interface QueueState {
  upNext: SongListItem[];
  playingFromSourceIds: string[];
  playingFromIndex: number;
  playingFromLabel: string | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setPlayingFrom: (ids: string[], label: string | null, startIndex?: number) => void;
  enqueueSongs: (songs: SongListItem[]) => void;
  reorderUpNext: (songIds: string[]) => void;
  removeFromUpNext: (songId: string) => void;
  shiftNextSongId: () => { song: SongListItem } | { id: string } | null;
  clearUpNext: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  upNext: [],
  playingFromSourceIds: [],
  playingFromIndex: 0,
  playingFromLabel: null,
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setPlayingFrom: (playingFromSourceIds, playingFromLabel, startIndex = 0) =>
    set({
      playingFromSourceIds,
      playingFromIndex: Math.max(0, Math.min(startIndex, playingFromSourceIds.length)),
      playingFromLabel,
    }),
  enqueueSongs: (songs) =>
    set((state) => {
      if (songs.length === 0) {
        return state;
      }
      const existingIds = new Set(state.upNext.map((song) => song.id));
      const nextSongs = songs.filter((song) => !existingIds.has(song.id));
      return {
        upNext: [...state.upNext, ...nextSongs],
      };
    }),
  reorderUpNext: (songIds) =>
    set((state) => {
      const byId = new Map(state.upNext.map((song) => [song.id, song]));
      const reordered: SongListItem[] = [];
      for (const songId of songIds) {
        const song = byId.get(songId);
        if (song) {
          reordered.push(song);
          byId.delete(songId);
        }
      }
      for (const song of byId.values()) {
        reordered.push(song);
      }
      return { upNext: reordered };
    }),
  removeFromUpNext: (songId) =>
    set((state) => ({
      upNext: state.upNext.filter((song) => song.id !== songId),
    })),
  shiftNextSongId: () => {
    const state = get();
    if (state.upNext.length > 0) {
      const [nextSong, ...rest] = state.upNext;
      set({ upNext: rest });
      return { song: nextSong };
    }

    if (state.playingFromIndex < state.playingFromSourceIds.length) {
      const nextId = state.playingFromSourceIds[state.playingFromIndex];
      set({ playingFromIndex: state.playingFromIndex + 1 });
      return { id: nextId };
    }

    return null;
  },
  clearUpNext: () => set({ upNext: [] }),
}));
