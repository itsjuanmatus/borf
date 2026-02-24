import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useLayoutEffect } from "react";
import { audioApi, mediaControlsApi } from "../../../lib/api";
import type { LibraryView, PlaybackState, SongListItem } from "../../../types";
import type { SongContextMenuState } from "../../metadata/SongContextMenu";

interface UseAppUiEffectsParams {
  persistedVolume: number;
  activeView: LibraryView;
  triggerStatsRefresh: () => void;
  tracePerf: (label: string, startedAt: number, extra?: string) => void;
  perfViewSwitchRef: MutableRefObject<{ view: string; startedAt: number } | null>;
  nowPlaying: SongListItem | null;
  playbackStateForMediaSync: PlaybackState;
  clipboardHint: string | null;
  setClipboardHint: Dispatch<SetStateAction<string | null>>;
  songContextMenu: SongContextMenuState | null;
  setSongContextMenu: Dispatch<SetStateAction<SongContextMenuState | null>>;
  contextMenuRef: MutableRefObject<HTMLDivElement | null>;
  setContextMenuPos: Dispatch<SetStateAction<{ left: number; top: number } | null>>;
}

export function useAppUiEffects({
  persistedVolume,
  activeView,
  triggerStatsRefresh,
  tracePerf,
  perfViewSwitchRef,
  nowPlaying,
  playbackStateForMediaSync,
  clipboardHint,
  setClipboardHint,
  songContextMenu,
  setSongContextMenu,
  contextMenuRef,
  setContextMenuPos,
}: UseAppUiEffectsParams) {
  useEffect(() => {
    void audioApi.setVolume(persistedVolume).catch(() => {
      // Ignore initial volume sync errors.
    });
  }, [persistedVolume]);

  useEffect(() => {
    const pending = perfViewSwitchRef.current;
    if (!pending || pending.view !== activeView) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      tracePerf(`view.switch.${activeView}.interactive`, pending.startedAt);
      if (perfViewSwitchRef.current === pending) {
        perfViewSwitchRef.current = null;
      }
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeView, perfViewSwitchRef, tracePerf]);

  useEffect(() => {
    if (activeView === "stats") {
      triggerStatsRefresh();
    }
  }, [activeView, triggerStatsRefresh]);

  useEffect(() => {
    mediaControlsApi
      .update({
        title: nowPlaying?.title,
        artist: nowPlaying?.artist,
        album: nowPlaying?.album,
        durationMs: nowPlaying?.duration_ms,
        playing: playbackStateForMediaSync === "playing",
      })
      .catch(() => {});
  }, [nowPlaying, playbackStateForMediaSync]);

  useEffect(() => {
    if (!clipboardHint) {
      return;
    }
    const timer = window.setTimeout(() => setClipboardHint(null), 2200);
    return () => window.clearTimeout(timer);
  }, [clipboardHint, setClipboardHint]);

  useEffect(() => {
    if (!songContextMenu) {
      return;
    }

    const close = () => setSongContextMenu(null);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("click", close);
    };
  }, [setSongContextMenu, songContextMenu]);

  useLayoutEffect(() => {
    if (!songContextMenu || !contextMenuRef.current) {
      setContextMenuPos(null);
      return;
    }
    const el = contextMenuRef.current;
    const pad = 8;
    const left = Math.max(
      pad,
      Math.min(songContextMenu.x, window.innerWidth - el.offsetWidth - pad),
    );
    const top = Math.max(
      pad,
      Math.min(songContextMenu.y, window.innerHeight - el.offsetHeight - pad),
    );
    setContextMenuPos({ left, top });
  }, [contextMenuRef, setContextMenuPos, songContextMenu]);
}
