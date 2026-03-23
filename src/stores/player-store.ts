import { create } from "zustand";
import type { PlaybackState, SongListItem } from "../types";

interface PlayerState {
  songs: SongListItem[];
  queueIds: string[];
  songCache: Map<string, SongListItem>;
  nowPlaying: SongListItem | null;
  currentIndex: number | null;
  playbackState: PlaybackState;
  positionMs: number;
  durationMs: number;
  setSongs: (songs: SongListItem[]) => void;
  setQueueIds: (ids: string[], currentIndex: number | null) => void;
  cacheSongs: (songs: SongListItem[]) => void;
  setNowPlaying: (song: SongListItem | null) => void;
  setCurrentIndex: (index: number | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  songs: [],
  queueIds: [],
  songCache: new Map(),
  nowPlaying: null,
  currentIndex: null,
  playbackState: "stopped",
  positionMs: 0,
  durationMs: 0,
  setSongs: (songs) => set({ songs }),
  setQueueIds: (queueIds, currentIndex) => {
    const { songCache } = get();
    const nowPlaying =
      currentIndex !== null && currentIndex >= 0 && currentIndex < queueIds.length
        ? songCache.get(queueIds[currentIndex]) ?? null
        : null;
    set({ queueIds, currentIndex, nowPlaying });
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
}));
