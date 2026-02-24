import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type MutableRefObject, useEffect } from "react";
import { audioApi } from "../../../lib/api";
import type {
  AudioErrorEvent,
  AudioPositionEvent,
  AudioStateEvent,
  AudioTrackEndedEvent,
  ItunesImportProgress,
  LibraryFileChangedEvent,
  PlaybackState,
  ScanProgressEvent,
} from "../../../types";

interface UseAppEventListenersParams {
  activePlaylistId: string | null;
  isScanning: boolean;
  setScanProgress: (progress: ScanProgressEvent | null) => void;
  setStatusMessage: (message: string) => void;
  setErrorMessage: (message: string | null) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPosition: (positionMs: number, durationMs: number) => void;
  setItunesProgress: (progress: ItunesImportProgress | null) => void;
  invalidatePlaylistCache: (playlistId: string) => void;
  refreshAllViews: () => Promise<void>;
  watcherRefreshTimeoutRef: MutableRefObject<number | null>;
  tracePerf: (label: string, startedAt: number, extra?: string) => void;
  perfPlayRequestRef: MutableRefObject<{ songId: string; startedAt: number } | null>;
  onPaused: () => void;
  onResumed: () => void;
  onPositionUpdate: (positionMs: number) => void;
  onTrackEnded: () => void;
  triggerStatsRefresh: () => void;
  playNext: () => void;
  playPrevious: () => void;
  handleTogglePlayback: () => Promise<void>;
  handleMediaKeyPlay: () => Promise<void>;
  handleMediaKeyPause: () => Promise<void>;
  handlePickFolderAndScan: () => Promise<void>;
  openImportWizard: () => void;
  setIsSearchPaletteOpen: (open: boolean) => void;
}

export function useAppEventListeners({
  activePlaylistId,
  isScanning,
  setScanProgress,
  setStatusMessage,
  setErrorMessage,
  setPlaybackState,
  setPosition,
  setItunesProgress,
  invalidatePlaylistCache,
  refreshAllViews,
  watcherRefreshTimeoutRef,
  tracePerf,
  perfPlayRequestRef,
  onPaused,
  onResumed,
  onPositionUpdate,
  onTrackEnded,
  triggerStatsRefresh,
  playNext,
  playPrevious,
  handleTogglePlayback,
  handleMediaKeyPlay,
  handleMediaKeyPause,
  handlePickFolderAndScan,
  openImportWizard,
  setIsSearchPaletteOpen,
}: UseAppEventListenersParams) {
  useEffect(() => {
    const unlisteners: Array<Promise<UnlistenFn>> = [
      listen<ScanProgressEvent>("library:scan-progress", (event) => {
        setScanProgress(event.payload);
      }),
      listen<AudioStateEvent>("audio:state-changed", (event) => {
        setPlaybackState(event.payload.state);
        if (event.payload.state === "playing" && perfPlayRequestRef.current) {
          tracePerf("audio.play.switch", perfPlayRequestRef.current.startedAt);
          perfPlayRequestRef.current = null;
        }
        if (event.payload.state === "paused") {
          onPaused();
        } else if (event.payload.state === "playing") {
          onResumed();
        }
      }),
      listen<AudioPositionEvent>("audio:position-update", (event) => {
        setPosition(event.payload.current_ms, event.payload.duration_ms);
        onPositionUpdate(event.payload.current_ms);
      }),
      listen<AudioTrackEndedEvent>("audio:track-ended", () => {
        onTrackEnded();
        triggerStatsRefresh();
        playNext();
      }),
      listen("mediakey:toggle", () => {
        void handleTogglePlayback().catch(() => {});
      }),
      listen("mediakey:play", () => {
        void handleMediaKeyPlay().catch(() => {});
      }),
      listen("mediakey:pause", () => {
        void handleMediaKeyPause().catch(() => {});
      }),
      listen("mediakey:next", () => {
        playNext();
      }),
      listen("mediakey:previous", () => {
        playPrevious();
      }),
      listen<AudioErrorEvent>("audio:error", (event) => {
        setErrorMessage(event.payload.message);
      }),
      listen<ItunesImportProgress>("import:itunes-progress", (event) => {
        setItunesProgress(event.payload);
      }),
      listen<LibraryFileChangedEvent>("library:file-changed", (event) => {
        if (isScanning) {
          return;
        }

        setStatusMessage(
          `Auto-sync: ${event.payload.reason} (${event.payload.changed_paths.length} path(s))`,
        );

        if (watcherRefreshTimeoutRef.current !== null) {
          window.clearTimeout(watcherRefreshTimeoutRef.current);
        }
        watcherRefreshTimeoutRef.current = window.setTimeout(() => {
          if (activePlaylistId) {
            invalidatePlaylistCache(activePlaylistId);
          }
          void audioApi.clearDecodedCache().catch(() => {
            // Ignore cache clear errors triggered by file watcher refresh.
          });
          void refreshAllViews().catch((error: unknown) => setErrorMessage(String(error)));
          watcherRefreshTimeoutRef.current = null;
        }, 700);
      }),
    ];

    return () => {
      if (watcherRefreshTimeoutRef.current !== null) {
        window.clearTimeout(watcherRefreshTimeoutRef.current);
        watcherRefreshTimeoutRef.current = null;
      }
      void Promise.all(unlisteners).then((callbacks) => {
        for (const callback of callbacks) {
          callback();
        }
      });
    };
  }, [
    activePlaylistId,
    handleMediaKeyPause,
    handleMediaKeyPlay,
    handleTogglePlayback,
    invalidatePlaylistCache,
    isScanning,
    onPaused,
    onPositionUpdate,
    onResumed,
    onTrackEnded,
    playNext,
    playPrevious,
    refreshAllViews,
    setErrorMessage,
    setItunesProgress,
    setPlaybackState,
    setPosition,
    setScanProgress,
    setStatusMessage,
    tracePerf,
    triggerStatsRefresh,
    watcherRefreshTimeoutRef,
    perfPlayRequestRef,
  ]);

  useEffect(() => {
    const unlisteners: Array<Promise<UnlistenFn>> = [
      listen("menu:scan-music-folder", () => {
        void handlePickFolderAndScan();
      }),
      listen("menu:import-itunes-library", () => {
        openImportWizard();
      }),
      listen("search:open-palette", () => {
        setIsSearchPaletteOpen(true);
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => {
        for (const callback of callbacks) {
          callback();
        }
      });
    };
  }, [handlePickFolderAndScan, openImportWizard, setIsSearchPaletteOpen]);
}
