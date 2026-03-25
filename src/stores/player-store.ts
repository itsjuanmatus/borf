import { create } from "zustand";
import type { PlaybackState, SongListItem } from "../types";

export interface DeferredCrossfade {
  song: SongListItem;
  queueIndex: number | null;
  fromUpNext: boolean;
  startedAt: number;
  positionAtStart: number;
  durationMs: number;
  pausedAt: number | null;
}

interface PlayerState {
  songs: SongListItem[];
  queueIds: string[];
  songCache: Map<string, SongListItem>;
  nowPlaying: SongListItem | null;
  currentIndex: number | null;
  playbackState: PlaybackState;
  positionMs: number;
  durationMs: number;
  deferredCrossfade: DeferredCrossfade | null;
  setSongs: (songs: SongListItem[]) => void;
  setQueueIds: (ids: string[], currentIndex: number | null) => void;
  cacheSongs: (songs: SongListItem[]) => void;
  setNowPlaying: (song: SongListItem | null) => void;
  setCurrentIndex: (index: number | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
  setDeferredCrossfade: (deferred: DeferredCrossfade | null) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  songs: [],
  queueIds: [],
  songCache: new Map(),
  nowPlaying: null,
  currentIndex: null,
  playbackState: "stopped",
  positionMs: 0,
  durationMs: 0,
  deferredCrossfade: null,
  setSongs: (songs) => set({ songs }),
  setQueueIds: (queueIds, currentIndex) => {
    set({ queueIds, currentIndex });
  },
  cacheSongs: (songs) =>
    set((state) => {
      const nextCache = new Map(state.songCache);
      for (const song of songs) {
        nextCache.set(song.id, song);
      }
      return { songCache: nextCache };
    }),
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaybackState: (playbackState) => set({ playbackState }),
  setPosition: (positionMs, durationMs) => set({ positionMs, durationMs }),
  setDeferredCrossfade: (deferredCrossfade) => set({ deferredCrossfade }),
}));
