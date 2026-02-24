import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioApi } from "../../../lib/api";
import { usePlayerStore } from "../../../stores/player-store";
import type {
  PlaybackState,
  PlaylistNode,
  PlaylistTrackItem,
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

  const queueHydrationTokenRef = useRef(0);
  const pendingQueueHydrationRef = useRef<{ token: number; promise: Promise<void> } | null>(null);

  const currentSong = useMemo(
    () => nowPlaying ?? (currentIndex !== null ? (queue[currentIndex] ?? null) : null),
    [currentIndex, nowPlaying, queue],
  );

  const beginPlaybackRequest = useCallback(() => {
    const nextToken = queueHydrationTokenRef.current + 1;
    queueHydrationTokenRef.current = nextToken;
    pendingQueueHydrationRef.current = null;
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

  useEffect(() => {
    if (queueSongIds.length === 0) {
      setQueue([], null);
      setCurrentIndex(null);
      setNowPlaying(null);
      return;
    }

    void loadSongsByIdsInBatches(queueSongIds)
      .then((restoredSongs) => {
        const restoredIndex =
          queueCurrentIndex !== null && queueCurrentIndex < restoredSongs.length
            ? queueCurrentIndex
            : null;

        setQueue(restoredSongs, restoredIndex);
        setCurrentIndex(restoredIndex);
        setNowPlaying(restoredIndex !== null ? (restoredSongs[restoredIndex] ?? null) : null);
        setQueueSourceSongs(restoredSongs);
        setPlayingFrom(
          restoredSongs,
          queueSourceLabel,
          restoredIndex !== null ? restoredIndex + 1 : 0,
        );
      })
      .catch((error: unknown) => setErrorMessage(String(error)));
  }, [
    loadSongsByIdsInBatches,
    queueCurrentIndex,
    queueSongIds,
    queueSourceLabel,
    setCurrentIndex,
    setErrorMessage,
    setNowPlaying,
    setPlayingFrom,
    setQueue,
  ]);

  return {
    currentSong,
    queueSourceSongs,
    setQueueSourceSongs,
    queueSourceLabel,
    setQueueSourceLabel,
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
