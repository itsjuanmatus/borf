import { create } from "zustand";
import type { SongListItem } from "../types";

interface QueueState {
  upNext: SongListItem[];
  playingFromSource: SongListItem[];
  playingFromIndex: number;
  playingFromLabel: string | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setPlayingFrom: (songs: SongListItem[], label: string | null, startIndex?: number) => void;
  enqueueSongs: (songs: SongListItem[]) => void;
  reorderUpNext: (songIds: string[]) => void;
  removeFromUpNext: (songId: string) => void;
  shiftNextSong: () => SongListItem | null;
  clearUpNext: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  upNext: [],
  playingFromSource: [],
  playingFromIndex: 0,
  playingFromLabel: null,
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setPlayingFrom: (playingFromSource, playingFromLabel, startIndex = 0) =>
    set({
      playingFromSource,
      playingFromIndex: Math.max(0, Math.min(startIndex, playingFromSource.length)),
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
  shiftNextSong: () => {
    const state = get();
    if (state.upNext.length > 0) {
      const [nextSong, ...rest] = state.upNext;
      set({ upNext: rest });
      return nextSong;
    }

    if (state.playingFromIndex < state.playingFromSource.length) {
      const nextSong = state.playingFromSource[state.playingFromIndex];
      set({ playingFromIndex: state.playingFromIndex + 1 });
      return nextSong;
    }

    return null;
  },
  clearUpNext: () => set({ upNext: [] }),
}));
