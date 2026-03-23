import { useCallback, useMemo, useRef, useState } from "react";
import type { AudioPlayOptions } from "../../../lib/api";
import { audioApi } from "../../../lib/api";
import { usePlayerStore } from "../../../stores/player-store";
import { useSessionStore } from "../../../stores/session-store";
import type {
  PlaybackState,
  PlaylistNode,
  PlaylistTrackItem,
  QueueRestoreMode,
  RepeatMode,
  SongListItem,
} from "../../../types";

interface UsePlaybackControllerParams {
  nowPlaying: SongListItem | null;
  currentIndex: number | null;
  songCount: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  songsByIndex: Record<number, SongListItem>;
  activePlaylist: PlaylistNode | null;
  activePlaylistTrackIds: string[];
  activePlaylistTracksByIndex: Array<PlaylistTrackItem | undefined>;
  songLookupById: Map<string, SongListItem>;
  loadAllSongsForCurrentSort: () => Promise<SongListItem[]>;
  loadSortedSongIds: () => Promise<string[]>;
  loadSongsByIdsInBatches: (songIds: string[]) => Promise<SongListItem[]>;
  onSongStarted: (song: SongListItem) => void;
  triggerStatsRefresh: () => void;
  setErrorMessage: (message: string | null) => void;
  markPlayRequest?: (songId: string) => void;
  persistQueue: (ids: string[], nextIndex: number | null) => void;
  setShuffleEnabled: (enabled: boolean) => void;
  setQueueIds: (ids: string[], currentIndex: number | null) => void;
  cacheSongs: (songs: SongListItem[]) => void;
  setCurrentIndex: (index: number | null) => void;
  setNowPlaying: (song: SongListItem | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
  upNext: SongListItem[];
  removeFromUpNext: (songId: string) => void;
  setPlayingFrom: (ids: string[], label: string | null, startIndex?: number) => void;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
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
const HYDRATION_LOOKAHEAD = 500;
const CROSSFADE_SECONDS_MIN = 1;
const CROSSFADE_SECONDS_MAX = 12;

type StartupTokenChecker = (token: number) => boolean;

interface QueueAdvanceTarget {
  song: SongListItem;
  queueIndex: number | null;
  fromUpNext: boolean;
}

function normalizeCrossfadeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return CROSSFADE_SECONDS_MIN;
  }
  return Math.max(CROSSFADE_SECONDS_MIN, Math.min(CROSSFADE_SECONDS_MAX, Math.round(seconds)));
}

function computeEffectiveCrossfadeMs(
  requestedFadeMs: number,
  currentDurationMs: number,
  nextDurationMs: number,
): number {
  const boundedRequest = Math.max(0, Math.floor(requestedFadeMs));
  const currentHalf = Math.max(0, Math.floor(Math.max(0, currentDurationMs) / 2));
  const nextHalf = Math.max(0, Math.floor(Math.max(0, nextDurationMs) / 2));
  return Math.min(boundedRequest, currentHalf, nextHalf);
}

export function usePlaybackController({
  nowPlaying,
  currentIndex,
  songCount,
  repeatMode,
  shuffleEnabled,
  songsByIndex,
  activePlaylist,
  activePlaylistTrackIds,
  activePlaylistTracksByIndex,
  songLookupById,
  loadAllSongsForCurrentSort,
  loadSortedSongIds,
  loadSongsByIdsInBatches,
  onSongStarted,
  triggerStatsRefresh,
  setErrorMessage,
  markPlayRequest,
  persistQueue,
  setShuffleEnabled,
  setQueueIds,
  cacheSongs,
  setCurrentIndex,
  setNowPlaying,
  setPlaybackState,
  setPosition,
  upNext,
  removeFromUpNext,
  setPlayingFrom,
  crossfadeEnabled,
  crossfadeSeconds,
}: UsePlaybackControllerParams) {
  const [queueSourceIds, setQueueSourceIds] = useState<string[]>([]);
  const [queueSourceLabel, setQueueSourceLabel] = useState<string | null>(null);
  const [isQueueHydrating, setIsQueueHydrating] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    hydrated: number;
    total: number;
  } | null>(null);

  const queueHydrationTokenRef = useRef(0);
  const queueRestoreTokenRef = useRef(0);
  const pendingQueueHydrationRef = useRef<{ token: number; promise: Promise<void> } | null>(null);
  const lastAutoCrossfadeSongIdRef = useRef<string | null>(null);

  const getQueueIds = useCallback(() => usePlayerStore.getState().queueIds, []);

  const currentSong = useMemo(() => {
    if (nowPlaying) {
      return nowPlaying;
    }
    if (currentIndex !== null) {
      const ids = usePlayerStore.getState().queueIds;
      const id = ids[currentIndex];
      return id ? (usePlayerStore.getState().songCache.get(id) ?? null) : null;
    }
    return null;
  }, [currentIndex, nowPlaying]);

  const beginPlaybackRequest = useCallback(() => {
    const nextToken = queueHydrationTokenRef.current + 1;
    queueHydrationTokenRef.current = nextToken;
    pendingQueueHydrationRef.current = null;
    queueRestoreTokenRef.current += 1;
    lastAutoCrossfadeSongIdRef.current = null;
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

  const resolveSongById = useCallback(
    async (songId: string): Promise<SongListItem | null> => {
      const cached = usePlayerStore.getState().songCache.get(songId);
      if (cached) {
        return cached;
      }
      const fetched = await loadSongsByIdsInBatches([songId]);
      if (fetched.length > 0) {
        cacheSongs(fetched);
        return fetched[0];
      }
      return null;
    },
    [cacheSongs, loadSongsByIdsInBatches],
  );

  const replaceQueueAndPlay = useCallback(
    async (
      songs: SongListItem[],
      startIndex: number,
      startMs?: number,
      options?: {
        requestToken?: number;
        sourceLabel?: string | null;
        playOptions?: AudioPlayOptions;
      },
    ) => {
      if (startIndex < 0 || startIndex >= songs.length) {
        return;
      }

      const requestToken = options?.requestToken ?? beginPlaybackRequest();
      if (!isPlaybackRequestCurrent(requestToken)) {
        return;
      }
      const sourceLabel = options?.sourceLabel ?? queueSourceLabel;
      const song = songs[startIndex];
      const ids = songs.map((s) => s.id);
      cacheSongs(songs);
      setQueueIds(ids, startIndex);
      persistQueue(ids, startIndex);
      setCurrentIndex(startIndex);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);

      markPlayRequest?.(song.id);
      await audioApi.play(song.id, startMs, options?.playOptions);
      if (!isPlaybackRequestCurrent(requestToken, song.id)) {
        return;
      }
      onSongStarted(song);
      triggerStatsRefresh();
      setErrorMessage(null);
      setPlayingFrom(ids, sourceLabel, startIndex + 1);
    },
    [
      beginPlaybackRequest,
      cacheSongs,
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
      setQueueIds,
      triggerStatsRefresh,
    ],
  );

  const playSong = useCallback(
    async (
      song: SongListItem,
      startMs?: number,
      requestToken?: number,
      playOptions?: AudioPlayOptions,
    ) => {
      const activeToken = requestToken ?? beginPlaybackRequest();
      if (!isPlaybackRequestCurrent(activeToken)) {
        return;
      }
      if (playOptions?.transition !== "crossfade") {
        lastAutoCrossfadeSongIdRef.current = null;
      }
      cacheSongs([song]);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      markPlayRequest?.(song.id);
      await audioApi.play(song.id, startMs, playOptions);
      if (!isPlaybackRequestCurrent(activeToken, song.id)) {
        return;
      }
      onSongStarted(song);
      triggerStatsRefresh();
    },
    [
      beginPlaybackRequest,
      cacheSongs,
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
    async (index: number, startMs?: number, playOptions?: AudioPlayOptions) => {
      const ids = getQueueIds();
      if (index < 0 || index >= ids.length) {
        return;
      }

      const songId = ids[index];
      let song: SongListItem | undefined = usePlayerStore.getState().songCache.get(songId);
      if (!song) {
        const resolved = await resolveSongById(songId);
        if (!resolved) {
          return;
        }
        song = resolved;
      }

      await playSong(song, startMs, undefined, playOptions);
      setCurrentIndex(index);
      persistQueue(ids, index);
      setErrorMessage(null);
      setPlayingFrom(ids, queueSourceLabel, index + 1);
    },
    [
      getQueueIds,
      persistQueue,
      playSong,
      queueSourceLabel,
      resolveSongById,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
    ],
  );

  const previewQueueAdvanceTarget = useCallback((): QueueAdvanceTarget | null => {
    const upNextSong = upNext[0];
    if (upNextSong) {
      return {
        song: upNextSong,
        queueIndex: null,
        fromUpNext: true,
      };
    }

    const ids = getQueueIds();
    if (ids.length === 0) {
      return null;
    }

    const cache = usePlayerStore.getState().songCache;

    if (currentIndex === null) {
      const firstSong = cache.get(ids[0]);
      if (!firstSong) {
        return null;
      }
      return {
        song: firstSong,
        queueIndex: 0,
        fromUpNext: false,
      };
    }

    if (currentIndex >= ids.length - 1) {
      if (repeatMode !== "all") {
        return null;
      }
      const wrappedSong = cache.get(ids[0]);
      if (!wrappedSong) {
        return null;
      }
      return {
        song: wrappedSong,
        queueIndex: 0,
        fromUpNext: false,
      };
    }

    const nextSong = cache.get(ids[currentIndex + 1]);
    if (!nextSong) {
      return null;
    }

    return {
      song: nextSong,
      queueIndex: currentIndex + 1,
      fromUpNext: false,
    };
  }, [currentIndex, getQueueIds, repeatMode, upNext]);

  const resolveQueueAdvancePlayOptions = useCallback(
    (nextSong: SongListItem, overrideFadeMs?: number): AudioPlayOptions => {
      if (!crossfadeEnabled || !currentSong) {
        return { transition: "immediate" };
      }

      const requestedFadeMs = overrideFadeMs ?? normalizeCrossfadeSeconds(crossfadeSeconds) * 1_000;
      const effectiveFadeMs = computeEffectiveCrossfadeMs(
        requestedFadeMs,
        currentSong.duration_ms,
        nextSong.duration_ms,
      );

      if (effectiveFadeMs <= 0) {
        return { transition: "immediate" };
      }

      return {
        transition: "crossfade",
        crossfadeMs: effectiveFadeMs,
      };
    },
    [crossfadeEnabled, crossfadeSeconds, currentSong],
  );

  const advanceQueueTarget = useCallback(
    async (target: QueueAdvanceTarget, playOptions: AudioPlayOptions) => {
      if (target.fromUpNext) {
        removeFromUpNext(target.song.id);
        await playSong(target.song, undefined, undefined, playOptions);
        setErrorMessage(null);
        return;
      }

      if (target.queueIndex !== null) {
        await playQueueIndex(target.queueIndex, undefined, playOptions);
      }
    },
    [playQueueIndex, playSong, removeFromUpNext, setErrorMessage],
  );

  const playNext = useCallback(() => {
    void (async () => {
      await waitForActiveQueueHydration();

      if (repeatMode === "one" && nowPlaying) {
        void playSong(nowPlaying, undefined, undefined, { transition: "immediate" }).catch(
          (error: unknown) => setErrorMessage(String(error)),
        );
        return;
      }

      const nextTarget = previewQueueAdvanceTarget();
      if (nextTarget) {
        const playOptions = resolveQueueAdvancePlayOptions(nextTarget.song);
        void advanceQueueTarget(nextTarget, playOptions).catch((error: unknown) =>
          setErrorMessage(String(error)),
        );
        return;
      }

      // Fallback: next song exists in queue but isn't cached yet
      const ids = getQueueIds();
      if (currentIndex !== null && currentIndex < ids.length - 1) {
        const nextId = ids[currentIndex + 1];
        const resolved = await resolveSongById(nextId);
        if (resolved) {
          void playQueueIndex(currentIndex + 1).catch((error: unknown) =>
            setErrorMessage(String(error)),
          );
          return;
        }
      }

      // Wrap around for repeat all
      if (currentIndex !== null && currentIndex >= ids.length - 1 && repeatMode === "all") {
        const firstId = ids[0];
        if (firstId) {
          const resolved = await resolveSongById(firstId);
          if (resolved) {
            void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
            return;
          }
        }
      }

      if (
        ids.length > 0 &&
        currentIndex !== null &&
        currentIndex >= ids.length - 1 &&
        repeatMode !== "all"
      ) {
        setPlaybackState("stopped");
      }
    })();
  }, [
    advanceQueueTarget,
    currentIndex,
    getQueueIds,
    nowPlaying,
    playSong,
    playQueueIndex,
    previewQueueAdvanceTarget,
    repeatMode,
    resolveSongById,
    resolveQueueAdvancePlayOptions,
    setErrorMessage,
    setPlaybackState,
    waitForActiveQueueHydration,
  ]);

  const handlePositionTick = useCallback(
    (positionMs: number, durationMs: number) => {
      if (!crossfadeEnabled || repeatMode === "one" || !currentSong) {
        return;
      }
      if (usePlayerStore.getState().playbackState !== "playing") {
        return;
      }

      const nextTarget = previewQueueAdvanceTarget();
      if (!nextTarget) {
        return;
      }

      const requestedFadeMs = normalizeCrossfadeSeconds(crossfadeSeconds) * 1_000;
      const trackDurationMs = durationMs > 0 ? durationMs : currentSong.duration_ms;
      const effectiveFadeMs = computeEffectiveCrossfadeMs(
        requestedFadeMs,
        trackDurationMs,
        nextTarget.song.duration_ms,
      );
      if (effectiveFadeMs <= 0) {
        return;
      }

      const remainingMs = Math.max(0, trackDurationMs - positionMs);
      if (remainingMs > effectiveFadeMs) {
        return;
      }
      if (lastAutoCrossfadeSongIdRef.current === currentSong.id) {
        return;
      }

      lastAutoCrossfadeSongIdRef.current = currentSong.id;
      const playOptions = resolveQueueAdvancePlayOptions(nextTarget.song, effectiveFadeMs);
      void advanceQueueTarget(nextTarget, playOptions).catch((error: unknown) =>
        setErrorMessage(String(error)),
      );
    },
    [
      advanceQueueTarget,
      crossfadeEnabled,
      crossfadeSeconds,
      currentSong,
      previewQueueAdvanceTarget,
      repeatMode,
      resolveQueueAdvancePlayOptions,
      setErrorMessage,
    ],
  );

  const playPrevious = useCallback(() => {
    void (async () => {
      await waitForActiveQueueHydration();

      const ids = getQueueIds();
      if (ids.length === 0) {
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
          void playQueueIndex(ids.length - 1).catch((error: unknown) =>
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
    getQueueIds,
    playQueueIndex,
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

    if (getQueueIds().length > 0) {
      const targetIndex = currentIndex ?? 0;
      await playQueueIndex(targetIndex);
      return;
    }

    if (songCount > 0) {
      const allSongs = await loadAllSongsForCurrentSort();
      if (allSongs.length > 0) {
        setQueueSourceIds(allSongs.map((s) => s.id));
        setQueueSourceLabel("Library");
        await replaceQueueAndPlay(allSongs, 0);
      }
    }
  }, [
    currentIndex,
    getQueueIds,
    loadAllSongsForCurrentSort,
    playQueueIndex,
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

      // Phase 0: Instant playback
      setQueueSourceIds([clickedSong.id]);
      setQueueSourceLabel(sourceLabel);
      await replaceQueueAndPlay([clickedSong], 0, undefined, {
        requestToken,
        sourceLabel,
      });

      const hydrationPromise = (async () => {
        // Phase 1: Fetch sorted IDs (single lightweight IPC call)
        const sortedIds = await loadSortedSongIds();
        if (!isPlaybackRequestCurrent(requestToken, clickedSong.id)) {
          return;
        }

        const clickedIndex = sortedIds.indexOf(clickedSong.id);
        if (clickedIndex < 0) {
          return;
        }

        // Set full ID list immediately (for persistence and queue length)
        setQueueIds(sortedIds, clickedIndex);
        persistQueue(sortedIds, clickedIndex);
        setCurrentIndex(clickedIndex);
        setQueueSourceIds(sortedIds);

        // Phase 2: Window hydration
        const windowStart = Math.max(0, clickedIndex - LAZY_RESTORE_WINDOW_RADIUS);
        const windowEnd = Math.min(sortedIds.length - 1, clickedIndex + LAZY_RESTORE_WINDOW_RADIUS);
        const windowIds = sortedIds.slice(windowStart, windowEnd + 1);
        const windowSongs = await loadSongsByIdsInBatches(windowIds);
        if (!isPlaybackRequestCurrent(requestToken, clickedSong.id)) {
          return;
        }

        cacheSongs(windowSongs);
        setPlayingFrom(sortedIds, sourceLabel, clickedIndex + 1);

        // Phase 3: Background lookahead hydration
        setIsQueueHydrating(true);
        const yieldToMainThread = () =>
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });

        const lookaheadStart = windowEnd + 1;
        const lookaheadEnd = Math.min(sortedIds.length, clickedIndex + HYDRATION_LOOKAHEAD);
        const lookbehindStart = Math.max(0, clickedIndex - HYDRATION_LOOKAHEAD);
        const lookbehindEnd = windowStart;

        const pendingIds = [
          ...sortedIds.slice(lookaheadStart, lookaheadEnd),
          ...sortedIds.slice(lookbehindStart, lookbehindEnd),
        ];

        for (let offset = 0; offset < pendingIds.length; offset += RESTORE_BACKGROUND_BATCH_SIZE) {
          const batch = pendingIds.slice(offset, offset + RESTORE_BACKGROUND_BATCH_SIZE);
          const batchSongs = await loadSongsByIdsInBatches(batch);
          if (!isPlaybackRequestCurrent(requestToken, clickedSong.id)) {
            return;
          }
          cacheSongs(batchSongs);
          await yieldToMainThread();
          if (!isPlaybackRequestCurrent(requestToken, clickedSong.id)) {
            return;
          }
        }

        setIsQueueHydrating(false);
      })().catch((error: unknown) => {
        if (queueHydrationTokenRef.current === requestToken) {
          setErrorMessage(String(error));
        }
      });

      registerQueueHydration(requestToken, hydrationPromise);
    },
    [
      beginPlaybackRequest,
      cacheSongs,
      isPlaybackRequestCurrent,
      loadSongsByIdsInBatches,
      loadSortedSongIds,
      persistQueue,
      registerQueueHydration,
      replaceQueueAndPlay,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
      setQueueIds,
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

      setQueueSourceIds([startSong.id]);
      setQueueSourceLabel(sourceLabel);
      await replaceQueueAndPlay([startSong], 0, undefined, {
        requestToken,
        sourceLabel,
      });

      const hydrationPromise = (async () => {
        // Set full ID list immediately
        setQueueIds(orderedSongIds, index);
        persistQueue(orderedSongIds, index);
        setCurrentIndex(index);
        setQueueSourceIds(orderedSongIds);
        cacheSongs([startSong]);

        // Window hydration around clicked index
        const windowStart = Math.max(0, index - LAZY_RESTORE_WINDOW_RADIUS);
        const windowEnd = Math.min(orderedSongIds.length - 1, index + LAZY_RESTORE_WINDOW_RADIUS);
        const windowIds = orderedSongIds.slice(windowStart, windowEnd + 1);

        const missingIds = windowIds.filter((id) => !songLookupById.has(id));
        if (missingIds.length > 0) {
          const fetchedSongs = await loadSongsByIdsInBatches(missingIds);
          cacheSongs(fetchedSongs);
        }

        if (!isPlaybackRequestCurrent(requestToken, startSongId)) {
          return;
        }

        setPlayingFrom(orderedSongIds, sourceLabel, index + 1);

        // Background hydration for remaining songs
        const yieldToMainThread = () =>
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });

        const pendingIds = orderedSongIds.filter((_id, i) => i < windowStart || i > windowEnd);

        for (let offset = 0; offset < pendingIds.length; offset += RESTORE_BACKGROUND_BATCH_SIZE) {
          const batch = pendingIds.slice(offset, offset + RESTORE_BACKGROUND_BATCH_SIZE);
          const batchSongs = await loadSongsByIdsInBatches(batch);
          if (!isPlaybackRequestCurrent(requestToken, startSongId)) {
            return;
          }
          cacheSongs(batchSongs);
          await yieldToMainThread();
          if (!isPlaybackRequestCurrent(requestToken, startSongId)) {
            return;
          }
        }
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
      cacheSongs,
      isPlaybackRequestCurrent,
      loadSongsByIdsInBatches,
      persistQueue,
      registerQueueHydration,
      replaceQueueAndPlay,
      setCurrentIndex,
      setErrorMessage,
      setPlayingFrom,
      setQueueIds,
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
      const { queueSongIds, queueCurrentIndex } = useSessionStore.getState();
      const total = queueSongIds.length;
      const isRestoreCurrent = () =>
        queueRestoreTokenRef.current === restoreToken && isStartupTokenCurrent(startupToken);

      if (!isRestoreCurrent()) {
        return;
      }

      if (total === 0) {
        setQueueIds([], null);
        setCurrentIndex(null);
        setNowPlaying(null);
        setQueueSourceIds([]);
        setPlayingFrom([], queueSourceLabel, 0);
        setIsQueueHydrating(false);
        setRestoreProgress(null);
        return;
      }

      // Set the full ID list immediately — this is cheap
      const safePersistedIndex =
        queueCurrentIndex !== null && queueCurrentIndex >= 0 && queueCurrentIndex < total
          ? queueCurrentIndex
          : null;

      setQueueIds(queueSongIds, safePersistedIndex);
      setQueueSourceIds(queueSongIds);
      setIsQueueHydrating(true);
      setRestoreProgress({ hydrated: 0, total });

      const hydrateSongs = async (songIds: string[]) => {
        const uniqueSongIds = Array.from(new Set(songIds));
        if (uniqueSongIds.length === 0) {
          return;
        }
        const resolvedSongs = await loadSongsByIdsInBatches(uniqueSongIds);
        cacheSongs(resolvedSongs);
      };

      const yieldToMainThread = () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });

      if (mode === "full") {
        await hydrateSongs(queueSongIds);
        if (!isRestoreCurrent()) {
          return;
        }

        // Resolve now playing from cache
        const nowPlayingSong =
          safePersistedIndex !== null
            ? (usePlayerStore.getState().songCache.get(queueSongIds[safePersistedIndex]) ?? null)
            : null;
        setNowPlaying(nowPlayingSong);
        setPlayingFrom(
          queueSongIds,
          queueSourceLabel,
          safePersistedIndex !== null ? safePersistedIndex + 1 : 0,
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

      const nowPlayingSong =
        safePersistedIndex !== null
          ? (usePlayerStore.getState().songCache.get(queueSongIds[safePersistedIndex]) ?? null)
          : null;
      setNowPlaying(nowPlayingSong);
      setPlayingFrom(
        queueSongIds,
        queueSourceLabel,
        safePersistedIndex !== null ? safePersistedIndex + 1 : 0,
      );
      setRestoreProgress({
        hydrated: initialEnd - initialStart + 1,
        total,
      });

      await yieldToMainThread();
      if (!isRestoreCurrent()) {
        return;
      }

      const pendingSongIds = queueSongIds.filter(
        (_songId, index) => index < initialStart || index > initialEnd,
      );
      let hydratedCount = initialEnd - initialStart + 1;
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

        hydratedCount += batch.length;
        setRestoreProgress({ hydrated: hydratedCount, total });
        await yieldToMainThread();
        if (!isRestoreCurrent()) {
          return;
        }
      }

      setRestoreProgress({ hydrated: total, total });
      setIsQueueHydrating(false);
      window.setTimeout(() => {
        if (isRestoreCurrent()) {
          setRestoreProgress(null);
        }
      }, 1500);
    },
    [
      cacheSongs,
      loadSongsByIdsInBatches,
      queueSourceLabel,
      setCurrentIndex,
      setNowPlaying,
      setPlayingFrom,
      setQueueIds,
    ],
  );

  const handleToggleShuffle = useCallback(() => {
    const ids = getQueueIds();
    if (ids.length === 0 || !currentSong) {
      return;
    }

    if (!shuffleEnabled) {
      // Save original order, then shuffle IDs
      setQueueSourceIds([...ids]);
      const remaining = ids.filter((id) => id !== currentSong.id);
      const shuffledIds = [currentSong.id, ...fisherYatesShuffle(remaining)];
      setQueueIds(shuffledIds, 0);
      setCurrentIndex(0);
      persistQueue(shuffledIds, 0);
      setShuffleEnabled(true);
      setPlayingFrom(shuffledIds, queueSourceLabel, 1);
      return;
    }

    // Restore original order
    const restoredIds = queueSourceIds.length > 0 ? queueSourceIds : ids;
    const restoredIndex = restoredIds.indexOf(currentSong.id);
    const nextIndex = restoredIndex >= 0 ? restoredIndex : 0;
    setQueueIds(restoredIds, nextIndex);
    setCurrentIndex(nextIndex);
    persistQueue(restoredIds, nextIndex);
    setShuffleEnabled(false);
    setPlayingFrom(restoredIds, queueSourceLabel, nextIndex + 1);
  }, [
    currentSong,
    getQueueIds,
    persistQueue,
    queueSourceIds,
    queueSourceLabel,
    setCurrentIndex,
    setPlayingFrom,
    setQueueIds,
    setShuffleEnabled,
    shuffleEnabled,
  ]);

  return {
    currentSong,
    queueSourceIds,
    setQueueSourceIds,
    queueSourceLabel,
    setQueueSourceLabel,
    isQueueHydrating,
    restoreProgress,
    bootstrapQueueRestore,
    replaceQueueAndPlay,
    playSong,
    playNext,
    playPrevious,
    handlePositionTick,
    handleTogglePlayback,
    handleMediaKeyPlay,
    handleMediaKeyPause,
    playFromSongsIndex,
    playFromPlaylistIndex,
    handleToggleShuffle,
  };
}
