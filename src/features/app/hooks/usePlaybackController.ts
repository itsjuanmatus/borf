import { useCallback, useMemo, useRef, useState } from "react";
import { audioApi } from "../../../lib/api";
import { usePlayerStore } from "../../../stores/player-store";
import type {
  PlaybackState,
  PlaylistNode,
  PlaylistTrackItem,
  QueueRestoreMode,
  RepeatMode,
  SongListItem,
} from "../../../types";

interface UsePlaybackControllerParams {
  queue: SongListItem[];
  nowPlaying: SongListItem | null;
  currentIndex: number | null;
  songCount: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  queueSongIds: string[];
  queueCurrentIndex: number | null;
  songsByIndex: Record<number, SongListItem>;
  activePlaylist: PlaylistNode | null;
  activePlaylistTrackIds: string[];
  activePlaylistTracksByIndex: Array<PlaylistTrackItem | undefined>;
  songLookupById: Map<string, SongListItem>;
  loadAllSongsForCurrentSort: () => Promise<SongListItem[]>;
  loadSongsByIdsInBatches: (songIds: string[]) => Promise<SongListItem[]>;
  onSongStarted: (song: SongListItem) => void;
  triggerStatsRefresh: () => void;
  setErrorMessage: (message: string | null) => void;
  markPlayRequest?: (songId: string) => void;
  persistQueue: (
    nextQueue: SongListItem[],
    nextIndex: number | null,
    persistSongIds?: boolean,
  ) => void;
  setShuffleEnabled: (enabled: boolean) => void;
  setQueue: (queue: SongListItem[], currentIndex: number | null) => void;
  setCurrentIndex: (index: number | null) => void;
  setNowPlaying: (song: SongListItem | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
  shiftNextSong: () => SongListItem | null;
  setPlayingFrom: (songs: SongListItem[], label: string | null, startIndex?: number) => void;
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

const LAZY_RESTORE_WINDOW_RADIUS = 25;
const MINIMAL_RESTORE_WINDOW_RADIUS = 5;
const RESTORE_BACKGROUND_BATCH_SIZE = 200;

type StartupTokenChecker = (token: number) => boolean;

export function usePlaybackController({
  queue,
  nowPlaying,
  currentIndex,
  songCount,
  repeatMode,
  shuffleEnabled,
  queueSongIds,
  queueCurrentIndex,
  songsByIndex,
  activePlaylist,
  activePlaylistTrackIds,
  activePlaylistTracksByIndex,
  songLookupById,
  loadAllSongsForCurrentSort,
  loadSongsByIdsInBatches,
  onSongStarted,
  triggerStatsRefresh,
  setErrorMessage,
  markPlayRequest,
  persistQueue,
  setShuffleEnabled,
  setQueue,
  setCurrentIndex,
  setNowPlaying,
  setPlaybackState,
  setPosition,
  shiftNextSong,
  setPlayingFrom,
}: UsePlaybackControllerParams) {
  const [queueSourceSongs, setQueueSourceSongs] = useState<SongListItem[]>([]);
  const [queueSourceLabel, setQueueSourceLabel] = useState<string | null>(null);
  const [isQueueHydrating, setIsQueueHydrating] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    hydrated: number;
    total: number;
  } | null>(null);

  const queueHydrationTokenRef = useRef(0);
  const queueRestoreTokenRef = useRef(0);
  const pendingQueueHydrationRef = useRef<{ token: number; promise: Promise<void> } | null>(null);

  const currentSong = useMemo(
    () => nowPlaying ?? (currentIndex !== null ? (queue[currentIndex] ?? null) : null),
    [currentIndex, nowPlaying, queue],
  );

  const beginPlaybackRequest = useCallback(() => {
    const nextToken = queueHydrationTokenRef.current + 1;
    queueHydrationTokenRef.current = nextToken;
    pendingQueueHydrationRef.current = null;
    queueRestoreTokenRef.current += 1;
    setIsQueueHydrating(false);
    setRestoreProgress(null);
    return nextToken;
  }, []);

  const isPlaybackRequestCurrent = useCallback((token: number, expectedSongId?: string) => {
    if (queueHydrationTokenRef.current !== token) {
      return false;
    }
    if (!expectedSongId) {
      return true;
    }
    return usePlayerStore.getState().nowPlaying?.id === expectedSongId;
  }, []);

  const registerQueueHydration = useCallback((token: number, promise: Promise<void>) => {
    pendingQueueHydrationRef.current = { token, promise };
    void promise.finally(() => {
      if (pendingQueueHydrationRef.current?.token === token) {
        pendingQueueHydrationRef.current = null;
      }
    });
  }, []);

  const waitForActiveQueueHydration = useCallback(async () => {
    const pending = pendingQueueHydrationRef.current;
    if (!pending || pending.token !== queueHydrationTokenRef.current) {
      return;
    }
    try {
      await pending.promise;
    } catch {
      // Hydration errors are reported by the hydration task itself.
    }
  }, []);

  const replaceQueueAndPlay = useCallback(
    async (
      nextQueue: SongListItem[],
      startIndex: number,
      startMs?: number,
      options?: { requestToken?: number; sourceLabel?: string | null },
    ) => {
      if (startIndex < 0 || startIndex >= nextQueue.length) {
        return;
      }

      const requestToken = options?.requestToken ?? beginPlaybackRequest();
      if (!isPlaybackRequestCurrent(requestToken)) {
        return;
      }
      const sourceLabel = options?.sourceLabel ?? queueSourceLabel;
      const song = nextQueue[startIndex];
      setQueue(nextQueue, startIndex);
      persistQueue(nextQueue, startIndex);
      setCurrentIndex(startIndex);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);

      markPlayRequest?.(song.id);
      await audioApi.play(song.id, startMs);
      if (!isPlaybackRequestCurrent(requestToken, song.id)) {
        return;
      }
      onSongStarted(song);
      triggerStatsRefresh();
      setErrorMessage(null);
      setPlayingFrom(nextQueue, sourceLabel, startIndex + 1);
    },
    [
      beginPlaybackRequest,
      isPlaybackRequestCurrent,
      onSongStarted,
      persistQueue,
      queueSourceLabel,
      markPlayRequest,
      setCurrentIndex,
      setErrorMessage,
      setNowPlaying,
      setPlaybackState,
      setPlayingFrom,
      setPosition,
      setQueue,
      triggerStatsRefresh,
    ],
  );

  const playSong = useCallback(
    async (song: SongListItem, startMs?: number, requestToken?: number) => {
      const activeToken = requestToken ?? beginPlaybackRequest();
      if (!isPlaybackRequestCurrent(activeToken)) {
        return;
      }
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      markPlayRequest?.(song.id);
      await audioApi.play(song.id, startMs);
      if (!isPlaybackRequestCurrent(activeToken, song.id)) {
        return;
      }
      onSongStarted(song);
      triggerStatsRefresh();
    },
    [
      beginPlaybackRequest,
      isPlaybackRequestCurrent,
      markPlayRequest,
      onSongStarted,
      setNowPlaying,
      setPlaybackState,
      setPosition,
      triggerStatsRefresh,
    ],
  );

  const playQueueIndex = useCallback(
    async (index: number, startMs?: number) => {
      if (index < 0 || index >= queue.length) {
        return;
      }

      const song = queue[index];
      await playSong(song, startMs);
      setCurrentIndex(index);
      persistQueue(queue, index, false);
      setErrorMessage(null);
      setPlayingFrom(queue, queueSourceLabel, index + 1);
    },
    [
      persistQueue,
      playSong,
      queue,
      queueSourceLabel,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
    ],
  );

  const playNext = useCallback(() => {
    void (async () => {
      await waitForActiveQueueHydration();

      if (repeatMode === "one" && nowPlaying) {
        void playSong(nowPlaying).catch((error: unknown) => setErrorMessage(String(error)));
        return;
      }

      const manualNext = shiftNextSong();
      if (manualNext) {
        void playSong(manualNext).catch((error: unknown) => setErrorMessage(String(error)));
        return;
      }

      if (queue.length === 0) {
        return;
      }

      if (currentIndex === null) {
        void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
        return;
      }

      if (currentIndex >= queue.length - 1) {
        if (repeatMode === "all") {
          void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
        } else {
          setPlaybackState("stopped");
        }
        return;
      }

      void playQueueIndex(currentIndex + 1).catch((error: unknown) =>
        setErrorMessage(String(error)),
      );
    })();
  }, [
    currentIndex,
    nowPlaying,
    playQueueIndex,
    playSong,
    queue.length,
    repeatMode,
    setErrorMessage,
    setPlaybackState,
    shiftNextSong,
    waitForActiveQueueHydration,
  ]);

  const playPrevious = useCallback(() => {
    void (async () => {
      await waitForActiveQueueHydration();

      if (queue.length === 0) {
        return;
      }

      const { positionMs, durationMs } = usePlayerStore.getState();
      if (positionMs > 3000) {
        void audioApi.seek(0).catch((error: unknown) => setErrorMessage(String(error)));
        setPosition(0, durationMs);
        return;
      }

      if (currentIndex === null) {
        void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
        return;
      }

      if (currentIndex === 0) {
        if (repeatMode === "all") {
          void playQueueIndex(queue.length - 1).catch((error: unknown) =>
            setErrorMessage(String(error)),
          );
        } else {
          void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
        }
        return;
      }

      void playQueueIndex(currentIndex - 1).catch((error: unknown) =>
        setErrorMessage(String(error)),
      );
    })();
  }, [
    currentIndex,
    playQueueIndex,
    queue.length,
    repeatMode,
    setErrorMessage,
    setPosition,
    waitForActiveQueueHydration,
  ]);

  const handleTogglePlayback = useCallback(async () => {
    const playbackState = usePlayerStore.getState().playbackState;
    if (playbackState === "playing") {
      await audioApi.pause();
      setPlaybackState("paused");
      return;
    }

    if (playbackState === "paused") {
      await audioApi.resume();
      setPlaybackState("playing");
      return;
    }

    if (queue.length > 0) {
      const targetIndex = currentIndex ?? 0;
      await playQueueIndex(targetIndex);
      return;
    }

    if (songCount > 0) {
      const allSongs = await loadAllSongsForCurrentSort();
      if (allSongs.length > 0) {
        setQueueSourceSongs(allSongs);
        setQueueSourceLabel("Library");
        await replaceQueueAndPlay(allSongs, 0);
      }
    }
  }, [
    currentIndex,
    loadAllSongsForCurrentSort,
    playQueueIndex,
    queue.length,
    replaceQueueAndPlay,
    setPlaybackState,
    songCount,
  ]);

  const handleMediaKeyPlay = useCallback(async () => {
    const playbackState = usePlayerStore.getState().playbackState;
    if (playbackState === "playing") {
      return;
    }
    if (playbackState === "paused") {
      await audioApi.resume();
      setPlaybackState("playing");
      return;
    }
    await handleTogglePlayback();
  }, [handleTogglePlayback, setPlaybackState]);

  const handleMediaKeyPause = useCallback(async () => {
    const playbackState = usePlayerStore.getState().playbackState;
    if (playbackState !== "playing") {
      return;
    }
    await audioApi.pause();
    setPlaybackState("paused");
  }, [setPlaybackState]);

  const playFromSongsIndex = useCallback(
    async (index: number) => {
      const clickedSong = songsByIndex[index];
      if (!clickedSong) {
        return;
      }

      const sourceLabel = "Library";
      const requestToken = beginPlaybackRequest();

      setQueueSourceSongs([clickedSong]);
      setQueueSourceLabel(sourceLabel);
      await replaceQueueAndPlay([clickedSong], 0, undefined, {
        requestToken,
        sourceLabel,
      });

      const hydrationPromise = (async () => {
        const allSongs = await loadAllSongsForCurrentSort();
        const startIndex = allSongs.findIndex((song) => song.id === clickedSong.id);
        if (startIndex < 0) {
          return;
        }
        if (!isPlaybackRequestCurrent(requestToken, clickedSong.id)) {
          return;
        }

        setQueueSourceSongs(allSongs);
        setQueueSourceLabel(sourceLabel);
        setQueue(allSongs, startIndex);
        persistQueue(allSongs, startIndex);
        setCurrentIndex(startIndex);
        setPlayingFrom(allSongs, sourceLabel, startIndex + 1);
      })().catch((error: unknown) => {
        if (queueHydrationTokenRef.current === requestToken) {
          setErrorMessage(String(error));
        }
      });

      registerQueueHydration(requestToken, hydrationPromise);
    },
    [
      beginPlaybackRequest,
      isPlaybackRequestCurrent,
      loadAllSongsForCurrentSort,
      persistQueue,
      registerQueueHydration,
      replaceQueueAndPlay,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
      setQueue,
      songsByIndex,
    ],
  );

  const playFromPlaylistIndex = useCallback(
    async (index: number) => {
      if (!activePlaylist) {
        return;
      }
      if (index < 0 || index >= activePlaylistTrackIds.length) {
        return;
      }
      const orderedSongIds = activePlaylistTrackIds;
      const startSongId = orderedSongIds[index];
      const sourceLabel = activePlaylist.name;

      let startSong =
        activePlaylistTracksByIndex[index]?.song ?? songLookupById.get(startSongId) ?? null;
      if (!startSong) {
        const fetched = await loadSongsByIdsInBatches([startSongId]);
        startSong = fetched[0] ?? null;
      }

      if (!startSong) {
        return;
      }

      const requestToken = beginPlaybackRequest();

      setQueueSourceSongs([startSong]);
      setQueueSourceLabel(sourceLabel);
      await replaceQueueAndPlay([startSong], 0, undefined, {
        requestToken,
        sourceLabel,
      });

      const hydrationPromise = (async () => {
        const songsById = new Map(songLookupById);
        songsById.set(startSong.id, startSong);

        const missingSongIds = Array.from(
          new Set(orderedSongIds.filter((songId) => !songsById.has(songId))),
        );
        if (missingSongIds.length > 0) {
          const fetchedSongs = await loadSongsByIdsInBatches(missingSongIds);
          for (const song of fetchedSongs) {
            songsById.set(song.id, song);
          }
        }

        const songs = orderedSongIds
          .map((songId) => songsById.get(songId))
          .filter((song): song is SongListItem => Boolean(song));
        const startIndex = songs.findIndex((song) => song.id === startSongId);
        if (startIndex < 0) {
          return;
        }
        if (!isPlaybackRequestCurrent(requestToken, startSongId)) {
          return;
        }

        setQueueSourceSongs(songs);
        setQueueSourceLabel(sourceLabel);
        setQueue(songs, startIndex);
        persistQueue(songs, startIndex);
        setCurrentIndex(startIndex);
        setPlayingFrom(songs, sourceLabel, startIndex + 1);
      })().catch((error: unknown) => {
        if (queueHydrationTokenRef.current === requestToken) {
          setErrorMessage(String(error));
        }
      });

      registerQueueHydration(requestToken, hydrationPromise);
    },
    [
      activePlaylist,
      activePlaylistTrackIds,
      activePlaylistTracksByIndex,
      beginPlaybackRequest,
      isPlaybackRequestCurrent,
      loadSongsByIdsInBatches,
      persistQueue,
      registerQueueHydration,
      replaceQueueAndPlay,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
      setQueue,
      songLookupById,
    ],
  );

  const bootstrapQueueRestore = useCallback(
    async (
      mode: QueueRestoreMode,
      startupToken: number,
      isStartupTokenCurrent: StartupTokenChecker,
    ) => {
      const restoreToken = queueRestoreTokenRef.current + 1;
      queueRestoreTokenRef.current = restoreToken;
      const total = queueSongIds.length;
      const isRestoreCurrent = () =>
        queueRestoreTokenRef.current === restoreToken && isStartupTokenCurrent(startupToken);

      if (!isRestoreCurrent()) {
        return;
      }

      if (total === 0) {
        setQueue([], null);
        setCurrentIndex(null);
        setNowPlaying(null);
        setQueueSourceSongs([]);
        setPlayingFrom([], queueSourceLabel, 0);
        setIsQueueHydrating(false);
        setRestoreProgress(null);
        return;
      }

      const safePersistedIndex =
        queueCurrentIndex !== null && queueCurrentIndex >= 0 && queueCurrentIndex < total
          ? queueCurrentIndex
          : null;
      const songById = new Map<string, SongListItem>();
      const hydrateSongs = async (songIds: string[]) => {
        const uniqueSongIds = Array.from(new Set(songIds));
        if (uniqueSongIds.length === 0) {
          return;
        }
        const resolvedSongs = await loadSongsByIdsInBatches(uniqueSongIds);
        for (const song of resolvedSongs) {
          songById.set(song.id, song);
        }
      };
      const materializeQueue = () =>
        queueSongIds
          .map((songId) => songById.get(songId))
          .filter((song): song is SongListItem => Boolean(song));
      const countHydrated = () =>
        queueSongIds.reduce((count, songId) => count + (songById.has(songId) ? 1 : 0), 0);
      const resolveRestoredIndex = (start = 0, end = queueSongIds.length - 1) => {
        if (safePersistedIndex === null || safePersistedIndex < start || safePersistedIndex > end) {
          return null;
        }
        let restoredOffset = 0;
        for (let index = start; index <= end; index += 1) {
          if (!songById.has(queueSongIds[index])) {
            continue;
          }
          if (index === safePersistedIndex) {
            return restoredOffset;
          }
          restoredOffset += 1;
        }
        return null;
      };
      const yieldToMainThread = () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });

      setIsQueueHydrating(true);
      setRestoreProgress({ hydrated: 0, total });

      if (mode === "full") {
        await hydrateSongs(queueSongIds);
        if (!isRestoreCurrent()) {
          return;
        }

        const restoredQueue = materializeQueue();
        const restoredIndex = resolveRestoredIndex();
        setQueue(restoredQueue, restoredIndex);
        setCurrentIndex(restoredIndex);
        setNowPlaying(restoredIndex !== null ? (restoredQueue[restoredIndex] ?? null) : null);
        setQueueSourceSongs(restoredQueue);
        setPlayingFrom(
          restoredQueue,
          queueSourceLabel,
          restoredIndex !== null ? restoredIndex + 1 : 0,
        );
        setRestoreProgress(null);
        setIsQueueHydrating(false);
        return;
      }

      const restoreRadius =
        mode === "minimal" ? MINIMAL_RESTORE_WINDOW_RADIUS : LAZY_RESTORE_WINDOW_RADIUS;
      const initialStart =
        safePersistedIndex === null ? 0 : Math.max(0, safePersistedIndex - restoreRadius);
      const initialEnd =
        safePersistedIndex === null
          ? Math.min(total - 1, restoreRadius * 2)
          : Math.min(total - 1, safePersistedIndex + restoreRadius);

      await hydrateSongs(queueSongIds.slice(initialStart, initialEnd + 1));
      if (!isRestoreCurrent()) {
        return;
      }

      const initialQueue = queueSongIds
        .slice(initialStart, initialEnd + 1)
        .map((songId) => songById.get(songId))
        .filter((song): song is SongListItem => Boolean(song));
      const initialIndex = resolveRestoredIndex(initialStart, initialEnd);

      setQueue(initialQueue, initialIndex);
      setCurrentIndex(initialIndex);
      setNowPlaying(initialIndex !== null ? (initialQueue[initialIndex] ?? null) : null);
      setQueueSourceSongs(initialQueue);
      setPlayingFrom(initialQueue, queueSourceLabel, initialIndex !== null ? initialIndex + 1 : 0);
      setRestoreProgress({ hydrated: countHydrated(), total });

      await yieldToMainThread();
      if (!isRestoreCurrent()) {
        return;
      }

      const pendingSongIds = queueSongIds.filter(
        (_songId, index) => index < initialStart || index > initialEnd,
      );
      for (
        let offset = 0;
        offset < pendingSongIds.length;
        offset += RESTORE_BACKGROUND_BATCH_SIZE
      ) {
        const batch = pendingSongIds.slice(offset, offset + RESTORE_BACKGROUND_BATCH_SIZE);
        await hydrateSongs(batch);
        if (!isRestoreCurrent()) {
          return;
        }

        setRestoreProgress({ hydrated: countHydrated(), total });
        await yieldToMainThread();
        if (!isRestoreCurrent()) {
          return;
        }
      }

      const restoredQueue = materializeQueue();
      const restoredIndex = resolveRestoredIndex();
      setQueue(restoredQueue, restoredIndex);
      setCurrentIndex(restoredIndex);
      setNowPlaying(restoredIndex !== null ? (restoredQueue[restoredIndex] ?? null) : null);
      setQueueSourceSongs(restoredQueue);
      setPlayingFrom(
        restoredQueue,
        queueSourceLabel,
        restoredIndex !== null ? restoredIndex + 1 : 0,
      );
      setRestoreProgress({ hydrated: countHydrated(), total });
      setIsQueueHydrating(false);
      window.setTimeout(() => {
        if (isRestoreCurrent()) {
          setRestoreProgress(null);
        }
      }, 1500);
    },
    [
      loadSongsByIdsInBatches,
      queueCurrentIndex,
      queueSongIds,
      queueSourceLabel,
      setCurrentIndex,
      setNowPlaying,
      setPlayingFrom,
      setQueue,
    ],
  );

  const handleToggleShuffle = useCallback(() => {
    if (queue.length === 0 || !currentSong) {
      return;
    }

    if (!shuffleEnabled) {
      const baseQueue = queue;
      const remaining = baseQueue.filter((song) => song.id !== currentSong.id);
      const shuffled = [currentSong, ...fisherYatesShuffle(remaining)];
      setQueueSourceSongs(baseQueue);
      setQueue(shuffled, 0);
      setCurrentIndex(0);
      persistQueue(shuffled, 0);
      setShuffleEnabled(true);
      setPlayingFrom(shuffled, queueSourceLabel, 1);
      return;
    }

    const restoredQueue = queueSourceSongs.length > 0 ? queueSourceSongs : queue;
    const restoredIndex = restoredQueue.findIndex((song) => song.id === currentSong.id);
    const nextIndex = restoredIndex >= 0 ? restoredIndex : 0;
    setQueue(restoredQueue, nextIndex);
    setCurrentIndex(nextIndex);
    persistQueue(restoredQueue, nextIndex);
    setShuffleEnabled(false);
    setPlayingFrom(restoredQueue, queueSourceLabel, nextIndex + 1);
  }, [
    currentSong,
    persistQueue,
    queue,
    queueSourceLabel,
    queueSourceSongs,
    setCurrentIndex,
    setPlayingFrom,
    setQueue,
    setShuffleEnabled,
    shuffleEnabled,
  ]);

  return {
    currentSong,
    queueSourceSongs,
    setQueueSourceSongs,
    queueSourceLabel,
    setQueueSourceLabel,
    isQueueHydrating,
    restoreProgress,
    bootstrapQueueRestore,
    replaceQueueAndPlay,
    playSong,
    playNext,
    playPrevious,
    handleTogglePlayback,
    handleMediaKeyPlay,
    handleMediaKeyPause,
    playFromSongsIndex,
    playFromPlaylistIndex,
    handleToggleShuffle,
  };
}
