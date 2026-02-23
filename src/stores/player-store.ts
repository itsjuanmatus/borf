import { create } from "zustand";
import type { PlaybackState, SongListItem } from "../types";

interface PlayerState {
  songs: SongListItem[];
  queue: SongListItem[];
  nowPlaying: SongListItem | null;
  currentIndex: number | null;
  playbackState: PlaybackState;
  positionMs: number;
  durationMs: number;
  setSongs: (songs: SongListItem[]) => void;
  setQueue: (queue: SongListItem[], currentIndex: number | null) => void;
  setNowPlaying: (song: SongListItem | null) => void;
  setCurrentIndex: (index: number | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  songs: [],
  queue: [],
  nowPlaying: null,
  currentIndex: null,
  playbackState: "stopped",
  positionMs: 0,
  durationMs: 0,
  setSongs: (songs) => set({ songs }),
  setQueue: (queue, currentIndex) =>
    set({
      queue,
      currentIndex,
      nowPlaying:
        currentIndex !== null && currentIndex >= 0 && currentIndex < queue.length
          ? queue[currentIndex]
          : null,
    }),
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setPosition: (positionMs, durationMs) => set({ positionMs, durationMs }),
}));
