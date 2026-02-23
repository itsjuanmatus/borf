import { useCallback, useRef } from "react";
import { historyApi } from "../../lib/api";
import type { SongListItem } from "../../types";

interface PlaySession {
  historyId: string;
  songId: string;
  durationMs: number;
  accumulatedMs: number;
  lastPositionMs: number;
  paused: boolean;
}

const COMPLETION_PERCENT = 0.5;
const COMPLETION_MIN_MS = 30_000;
const SEEK_THRESHOLD_MS = 3000;

export function usePlayTracking() {
  const sessionRef = useRef<PlaySession | null>(null);

  const finalizeSession = useCallback((skipIfShort: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;

    const completed =
      session.accumulatedMs >= session.durationMs * COMPLETION_PERCENT ||
      session.accumulatedMs >= COMPLETION_MIN_MS;

    if (skipIfShort && !completed) {
      historyApi.recordSkip(session.songId).catch(() => {});
    }

    historyApi
      .recordEnd(session.historyId, Math.round(session.accumulatedMs), completed)
      .catch(() => {});
  }, []);

  const onSongStarted = useCallback(
    (song: SongListItem) => {
      finalizeSession(true);

      const historyId = crypto.randomUUID();
      sessionRef.current = {
        historyId,
        songId: song.id,
        durationMs: song.duration_ms,
        accumulatedMs: 0,
        lastPositionMs: song.custom_start_ms ?? 0,
        paused: false,
      };

      historyApi.recordStart(historyId, song.id).catch(() => {});
    },
    [finalizeSession],
  );

  const onPositionUpdate = useCallback((currentMs: number) => {
    const session = sessionRef.current;
    if (!session || session.paused) return;

    const delta = currentMs - session.lastPositionMs;
    if (delta > 0 && delta < SEEK_THRESHOLD_MS) {
      session.accumulatedMs += delta;
    }
    session.lastPositionMs = currentMs;
  }, []);

  const onPaused = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.paused = true;
    }
  }, []);

  const onResumed = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.paused = false;
    }
  }, []);

  const onTrackEnded = useCallback(() => {
    finalizeSession(false);
  }, [finalizeSession]);

  return { onSongStarted, onPositionUpdate, onPaused, onResumed, onTrackEnded };
}
