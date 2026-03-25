import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SongArtwork } from "./components/song-artwork";
import { TooltipProvider } from "./components/ui/tooltip";
import { useAppDialogLayerProps } from "./features/app/hooks/useAppDialogLayerProps";
import { useAppEventListeners } from "./features/app/hooks/useAppEventListeners";
import { useAppMainContentProps } from "./features/app/hooks/useAppMainContentProps";
import { useAppUiEffects } from "./features/app/hooks/useAppUiEffects";
import { useExportActions } from "./features/app/hooks/useExportActions";
import { useGlobalKeyboardShortcuts } from "./features/app/hooks/useGlobalKeyboardShortcuts";
import { useLibraryController } from "./features/app/hooks/useLibraryController";
import { useMetadataImportController } from "./features/app/hooks/useMetadataImportController";
import { useNavigationController } from "./features/app/hooks/useNavigationController";
import { usePlaybackController } from "./features/app/hooks/usePlaybackController";
import { usePlaylistController } from "./features/app/hooks/usePlaylistController";
import { useScrollRestoreEffect } from "./features/app/hooks/useScrollRestoreEffect";
import { useSearchPaletteActionHandler } from "./features/app/hooks/useSearchPaletteActionHandler";
import { useStartupBootstrap } from "./features/app/hooks/useStartupBootstrap";
import { AppDialogLayer } from "./features/app/layout/AppDialogLayer";
import { AppHeader } from "./features/app/layout/AppHeader";
import { AppMainContent } from "./features/app/layout/AppMainContent";
import { AppSidebar } from "./features/app/layout/AppSidebar";
import { getHeaderText } from "./features/app/layout/header-text";
import { usePlayTracking } from "./features/history/usePlayTracking";
import type { SongContextMenuState } from "./features/metadata/SongContextMenu";
import { TransportBar } from "./features/player/TransportBar";
import { UpNextPanel } from "./features/queue/UpNextPanel";
import { UpdateDialog } from "./features/settings/UpdateDialog";
import { useAppUpdate } from "./features/settings/useAppUpdate";
import { audioApi, libraryApi } from "./lib/api";
import { startupTrace } from "./lib/startup-trace";
import { usePlayerStore } from "./stores/player-store";
import { useQueueStore } from "./stores/queue-store";
import { useSessionStore } from "./stores/session-store";
import type {
  LibraryFileChangedEvent,
  QueueRestoreMode,
  RepeatMode,
  ScanProgressEvent,
  SongListItem,
} from "./types";

const SCROLL_RESTORE_MAX_ATTEMPTS = 12;
const WATCHER_FULL_REFRESH_COOLDOWN_MS = 10_000;
const STARTUP_QUEUE_RESTORE_MODE: QueueRestoreMode = "lazy";
const PERF_TRACE_ENABLED = (() => {
  const rawValue = String(import.meta.env.VITE_PERF_TRACE ?? "").toLowerCase();
  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
})();

function cycleRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === "off") {
    return "all";
  }
  if (mode === "all") {
    return "one";
  }
  return "off";
}

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState("Choose a music folder to start scanning.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [songContextMenu, setSongContextMenu] = useState<SongContextMenuState | null>(null);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);

  const sidebarSize = useSessionStore((state) => state.sidebarSize);
  const setSidebarSize = useSessionStore((state) => state.setSidebarSize);
  const persistedVolume = useSessionStore((state) => state.volume);
  const setPersistedVolume = useSessionStore((state) => state.setVolume);
  const crossfadeEnabled = useSessionStore((state) => state.crossfadeEnabled);
  const crossfadeSeconds = useSessionStore((state) => state.crossfadeSeconds);
  const setCrossfadeEnabled = useSessionStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeSeconds = useSessionStore((state) => state.setCrossfadeSeconds);

  const activeView = useSessionStore((state) => state.activeView);
  const setActiveView = useSessionStore((state) => state.setActiveView);
  const activePlaylistId = useSessionStore((state) => state.activePlaylistId);
  const setActivePlaylistId = useSessionStore((state) => state.setActivePlaylistId);

  const setQueueSongIds = useSessionStore((state) => state.setQueueSongIds);
  const setQueueCurrentIndex = useSessionStore((state) => state.setQueueCurrentIndex);
  const repeatMode = useSessionStore((state) => state.repeatMode);
  const setRepeatMode = useSessionStore((state) => state.setRepeatMode);
  const shuffleEnabled = useSessionStore((state) => state.shuffleEnabled);
  const setShuffleEnabled = useSessionStore((state) => state.setShuffleEnabled);

  const queueLength = usePlayerStore((state) => state.queueIds.length);
  const nowPlaying = usePlayerStore((state) => state.nowPlaying);
  const currentIndex = usePlayerStore((state) => state.currentIndex);

  const setQueueIds = usePlayerStore((state) => state.setQueueIds);
  const cacheSongs = usePlayerStore((state) => state.cacheSongs);
  const setNowPlaying = usePlayerStore((state) => state.setNowPlaying);
  const setCurrentIndex = usePlayerStore((state) => state.setCurrentIndex);
  const setPlaybackState = usePlayerStore((state) => state.setPlaybackState);
  const setPosition = usePlayerStore((state) => state.setPosition);

  const upNext = useQueueStore((state) => state.upNext);
  const playingFromSourceIds = useQueueStore((state) => state.playingFromSourceIds);
  const playingFromIndex = useQueueStore((state) => state.playingFromIndex);
  const playingFromLabel = useQueueStore((state) => state.playingFromLabel);
  const enqueueSongs = useQueueStore((state) => state.enqueueSongs);
  const reorderUpNext = useQueueStore((state) => state.reorderUpNext);
  const removeFromUpNext = useQueueStore((state) => state.removeFromUpNext);
  const setPlayingFrom = useQueueStore((state) => state.setPlayingFrom);
  const upNextOpen = useQueueStore((state) => state.isOpen);
  const openUpNext = useQueueStore((state) => state.open);
  const closeUpNext = useQueueStore((state) => state.close);
  const playingFrom = useMemo(() => {
    const ids = playingFromSourceIds.slice(playingFromIndex, playingFromIndex + 50);
    const cache = usePlayerStore.getState().songCache;
    return ids.map((id) => cache.get(id)).filter((song): song is SongListItem => Boolean(song));
  }, [playingFromIndex, playingFromSourceIds]);

  const songsScrollRef = useRef<HTMLDivElement | null>(null);
  const albumsScrollRef = useRef<HTMLDivElement | null>(null);
  const albumDetailScrollRef = useRef<HTMLDivElement | null>(null);
  const artistsScrollRef = useRef<HTMLDivElement | null>(null);
  const artistAlbumsScrollRef = useRef<HTMLDivElement | null>(null);
  const artistAlbumTracksScrollRef = useRef<HTMLDivElement | null>(null);
  const playlistFolderScrollRef = useRef<HTMLDivElement | null>(null);
  const statsScrollRef = useRef<HTMLDivElement | null>(null);
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const watcherRefreshTimeoutRef = useRef<number | null>(null);
  const watcherLastFullRefreshAtRef = useRef(0);
  const perfPlayRequestRef = useRef<{ songId: string; startedAt: number } | null>(null);
  const perfViewSwitchRef = useRef<{ view: string; startedAt: number } | null>(null);
  const [statsRefreshSignal, setStatsRefreshSignal] = useState(0);
  const appUpdate = useAppUpdate();

  const {
    onSongStarted,
    onPositionUpdate: onPlayTrackingPositionUpdate,
    onPaused,
    onResumed,
    onTrackEnded,
  } = usePlayTracking();
  const triggerStatsRefresh = useCallback(() => {
    setStatsRefreshSignal((current) => current + 1);
  }, []);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);
  const tracePerf = useCallback((label: string, startedAt: number, extra?: string) => {
    if (!PERF_TRACE_ENABLED) {
      return;
    }
    const elapsedMs = performance.now() - startedAt;
    console.debug(`[perf] ${label} ${elapsedMs.toFixed(1)}ms${extra ? ` (${extra})` : ""}`);
  }, []);

  const persistQueue = useCallback(
    (ids: string[], nextIndex: number | null) => {
      setQueueSongIds(ids);
      setQueueCurrentIndex(nextIndex);
    },
    [setQueueCurrentIndex, setQueueSongIds],
  );
  const libraryController = useLibraryController({
    activeView,
    songsScrollRef,
    albumsScrollRef,
    artistsScrollRef,
    persistQueue,
    setStatusMessage,
    setErrorMessage,
  });
  const {
    songCount,
    songsByIndex,
    albums,
    artists,
    selectedAlbum,
    setSelectedAlbum,
    albumTracks,
    setAlbumTracks,
    selectedArtist,
    setSelectedArtist,
    setArtistAlbums,
    selectedArtistAlbum,
    setSelectedArtistAlbum,
    artistAlbumTracks,
    setArtistAlbumTracks,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearchPaletteOpen,
    setIsSearchPaletteOpen,
    paletteCatalogSongs,
    tags,
    selectedTagFilterIds,
    setSelectedTagFilterIds,
    resetSongPages,
    bootstrapSongs,
    bootstrapAlbums,
    bootstrapArtists,
    bootstrapTags,
    refreshSongCount,
    ensureSongPage,
    loadAllSongsForCurrentSort,
    loadSongsByIdsInBatches,
    refreshAlbums,
    refreshArtists,
    refreshTags,
    openAlbum,
    openArtist,
    openArtistAlbum,
  } = libraryController;

  const songLookupByIdRef = useRef<Map<string, SongListItem>>(new Map());
  const resolveSongsByIds = useCallback((songIds: string[]) => {
    return songIds
      .map((songId) => songLookupByIdRef.current.get(songId))
      .filter((song): song is SongListItem => Boolean(song));
  }, []);

  const playlistController = usePlaylistController({
    activeView,
    activePlaylistId,
    setActiveView,
    setActivePlaylistId,
    setSelectedAlbum,
    setSelectedArtist,
    setSelectedArtistAlbum,
    setErrorMessage,
    tracePerf,
    perfViewSwitchRef,
    upNext,
    reorderUpNext,
    enqueueSongs,
    resolveSongsByIds,
  });
  const {
    playlists,
    selectedSongIds,
    clipboardSongIds,
    copySelectionToClipboard,
    setClipboardSongIds,
    clearSelection,
    invalidatePlaylistCache,
    activePlaylist,
    activeFolderChildren,
    activePlaylistTrackIds,
    activePlaylistTrackCount,
    activePlaylistTracksByIndex,
    activePlaylistLoadedTracks,
    playlistReorderMode,
    setPlaylistReorderMode,
    dragOverlayLabel,
    dragOverlayCount,
    dragOverlaySong,
    bootstrapPlaylists,
    refreshPlaylists,
    refreshPlaylistTracks,
    openPlaylist,
    handleCreatePlaylist,
    handleRenamePlaylist,
    handleDeletePlaylist,
    handleDuplicatePlaylist,
    handleExportPlaylistM3u8,
    addSongsToQueue,
    handleDragStart,
    handleDragEnd,
  } = playlistController;

  const songLookupById = useMemo(() => {
    const lookup = new Map<string, SongListItem>();
    for (const song of Object.values(songsByIndex)) {
      lookup.set(song.id, song);
    }
    for (const track of activePlaylistLoadedTracks) {
      lookup.set(track.song.id, track.song);
    }
    for (const song of searchResults?.songs ?? []) {
      lookup.set(song.id, song);
    }
    for (const song of albumTracks) {
      lookup.set(song.id, song);
    }
    for (const song of artistAlbumTracks) {
      lookup.set(song.id, song);
    }
    return lookup;
  }, [activePlaylistLoadedTracks, albumTracks, artistAlbumTracks, searchResults, songsByIndex]);

  songLookupByIdRef.current = songLookupById;

  const paletteLocalSongs = useMemo(() => {
    if (paletteCatalogSongs.length > 0) {
      return paletteCatalogSongs;
    }
    return Array.from(songLookupById.values());
  }, [paletteCatalogSongs, songLookupById]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const playbackController = usePlaybackController({
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
    loadSortedSongIds: libraryController.loadSortedSongIds,
    loadSongsByIdsInBatches,
    onSongStarted,
    triggerStatsRefresh,
    setErrorMessage,
    markPlayRequest: (songId) => {
      perfPlayRequestRef.current = { songId, startedAt: performance.now() };
    },
    persistQueue,
    setShuffleEnabled,
    setQueueIds,
    cacheSongs,
    setCurrentIndex,
    setNowPlaying,
    setPlaybackState,
    setPosition,
    removeFromUpNext,
    setPlayingFrom,
    crossfadeEnabled,
    crossfadeSeconds,
  });
  const {
    currentSong,
    setQueueSourceIds,
    setQueueSourceLabel,
    isQueueHydrating,
    restoreProgress,
    bootstrapQueueRestore,
    replaceQueueAndPlay,
    playNext,
    playPrevious,
    handlePositionTick,
    handleSeek,
    handleTogglePlayback,
    handleMediaKeyPlay,
    handleMediaKeyPause,
    playFromSongsIndex,
    playFromPlaylistIndex,
    handleToggleShuffle,
  } = playbackController;

  const handlePlaybackPositionUpdate = useCallback(
    (positionMs: number, durationMs: number) => {
      onPlayTrackingPositionUpdate(positionMs);
      handlePositionTick(positionMs, durationMs);
    },
    [handlePositionTick, onPlayTrackingPositionUpdate],
  );

  const navigationController = useNavigationController({
    activeView,
    activePlaylistId,
    activePlaylist,
    selectedAlbum,
    selectedArtist,
    selectedArtistAlbum,
    searchQuery,
    selectedTagFilterIds,
    playlistReorderMode,
    upNextOpen,
    openUpNext,
    closeUpNext,
    setSearchQuery,
    setSelectedTagFilterIds,
    setPlaylistReorderMode,
    setActiveView,
    setActivePlaylistId,
    setSelectedAlbum,
    setAlbumTracks,
    setSelectedArtist,
    setSelectedArtistAlbum,
    setArtistAlbums,
    setArtistAlbumTracks,
    clearSelection,
    openAlbum,
    openArtist,
    openArtistAlbum,
    openPlaylist,
    setErrorMessage,
    perfViewSwitchRef,
    scrollRefs: {
      songsScrollRef,
      albumsScrollRef,
      albumDetailScrollRef,
      artistsScrollRef,
      artistAlbumsScrollRef,
      artistAlbumTracksScrollRef,
      playlistFolderScrollRef,
      statsScrollRef,
      settingsScrollRef,
    },
  });
  const {
    currentRouteKey,
    pendingScrollRestoreRef,
    scrollRestoreTick,
    pastStack,
    futureStack,
    resolveScrollElementForRoute,
    applyRoute,
    navigateToRoute,
    goBack,
    goForward,
  } = navigationController;

  const { handleExportPlayStatsCsv, handleExportTagsCsv, handleExportHierarchyMd } =
    useExportActions({
      setErrorMessage,
    });

  const refreshSongsView = useCallback(async () => {
    resetSongPages();
    await refreshSongCount();
    await ensureSongPage(0);
  }, [ensureSongPage, refreshSongCount, resetSongPages]);

  const refreshAllViews = useCallback(async () => {
    startupTrace("refresh.full.begin");
    await refreshSongsView();

    const refreshTasks: Array<Promise<unknown>> = [
      refreshAlbums(),
      refreshArtists(),
      refreshPlaylists(),
      refreshTags(),
    ];
    if (activePlaylistId) {
      refreshTasks.push(refreshPlaylistTracks(activePlaylistId));
    }
    await Promise.all(refreshTasks);
    startupTrace("refresh.full.end");
  }, [
    activePlaylistId,
    refreshAlbums,
    refreshArtists,
    refreshPlaylists,
    refreshPlaylistTracks,
    refreshSongsView,
    refreshTags,
  ]);

  const refreshAllViewsWithCooldown = useCallback(async () => {
    const now = Date.now();
    if (now - watcherLastFullRefreshAtRef.current < WATCHER_FULL_REFRESH_COOLDOWN_MS) {
      startupTrace("watcher.refresh.full.skipped.cooldown");
      return false;
    }
    watcherLastFullRefreshAtRef.current = now;
    await refreshAllViews();
    return true;
  }, [refreshAllViews]);

  const refreshFromWatcherEvent = useCallback(
    async (event: LibraryFileChangedEvent) => {
      startupTrace(
        "watcher.refresh.begin",
        `${event.change_scope}:${event.reason}:${event.changed_paths.length}`,
      );

      if (event.change_scope === "bulk") {
        const ranFullRefresh = await refreshAllViewsWithCooldown();
        if (ranFullRefresh) {
          startupTrace("watcher.refresh.end", "bulk:full-refresh");
          return;
        }
      }

      await refreshSongsView();

      if (activeView === "albums") {
        await refreshAlbums();
        if (selectedAlbum) {
          await openAlbum(
            {
              album: selectedAlbum.album,
              album_artist: selectedAlbum.album_artist,
            },
            { allowToggle: false },
          );
        }
      } else if (activeView === "artists") {
        await refreshArtists();
        if (selectedArtist) {
          await openArtist(selectedArtist);
          if (selectedArtistAlbum) {
            await openArtistAlbum({
              album: selectedArtistAlbum.album,
              album_artist: selectedArtistAlbum.album_artist,
            });
          }
        }
      } else if (activeView === "playlist") {
        await refreshPlaylists();
        if (activePlaylistId) {
          invalidatePlaylistCache(activePlaylistId);
          await refreshPlaylistTracks(activePlaylistId);
        }
      } else if (activeView === "settings") {
        await refreshTags();
      }

      startupTrace("watcher.refresh.end", event.change_scope);
    },
    [
      activePlaylistId,
      activeView,
      invalidatePlaylistCache,
      openAlbum,
      openArtist,
      openArtistAlbum,
      refreshAlbums,
      refreshAllViewsWithCooldown,
      refreshArtists,
      refreshPlaylists,
      refreshPlaylistTracks,
      refreshSongsView,
      refreshTags,
      selectedAlbum,
      selectedArtist,
      selectedArtistAlbum,
    ],
  );
  const metadataImportController = useMetadataImportController({
    songLookupById,
    loadSongsByIdsInBatches,
    refreshAllViews,
    setErrorMessage,
  });
  const { itunesProgress, setItunesProgress, openImportWizard } = metadataImportController;

  useStartupBootstrap({
    activeView,
    queueRestoreMode: STARTUP_QUEUE_RESTORE_MODE,
    bootstrapSongs,
    bootstrapAlbums,
    bootstrapArtists,
    bootstrapPlaylists,
    bootstrapTags,
    bootstrapQueueRestore,
    setErrorMessage,
  });

  const handlePickFolderAndScan = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a music folder",
    });

    if (typeof selected !== "string") {
      return;
    }

    setIsScanning(true);
    setScanProgress(null);
    setStatusMessage(`Scanning ${selected}...`);
    setErrorMessage(null);

    try {
      await libraryApi.scan(selected);
      setStatusMessage("Scan complete.");
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    } finally {
      setIsScanning(false);
    }
  }, [refreshAllViews]);

  const handleExecuteSearchPaletteItem = useSearchPaletteActionHandler({
    activePlaylistId,
    playlists,
    applyRoute,
    openPlaylist,
    setStatusMessage,
    setQueueSourceIds,
    setQueueSourceLabel,
    replaceQueueAndPlay,
    enqueueSongs,
    handlePickFolderAndScan,
    openImportWizard,
  });

  useAppEventListeners({
    isScanning,
    setScanProgress,
    setStatusMessage,
    setErrorMessage,
    setPlaybackState,
    setPosition,
    setItunesProgress,
    refreshFromWatcherEvent,
    watcherRefreshTimeoutRef,
    tracePerf,
    perfPlayRequestRef,
    onPaused,
    onResumed,
    onPositionUpdate: handlePlaybackPositionUpdate,
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
  });

  useGlobalKeyboardShortcuts({
    activeView,
    activePlaylistId,
    activePlaylistIsFolder: activePlaylist?.is_folder ?? false,
    selectedSongIds,
    copySelectionToClipboard,
    clipboardSongIds,
    refreshPlaylistTracks,
    setClipboardHint,
    setErrorMessage,
    closeUpNext,
    isSearchPaletteOpen,
    setIsSearchPaletteOpen,
    goBack,
    goForward,
  });
  const playbackStateForMediaSync = usePlayerStore((state) => state.playbackState);
  useAppUiEffects({
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
  });
  useScrollRestoreEffect({
    scrollRestoreTick,
    currentRouteKey,
    activePlaylistIsFolder: activePlaylist?.is_folder ?? false,
    pendingScrollRestoreRef,
    resolveScrollElementForRoute,
    maxAttempts: SCROLL_RESTORE_MAX_ATTEMPTS,
  });

  const progressPercent = useMemo(() => {
    if (!scanProgress || scanProgress.total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100));
  }, [scanProgress]);

  const importProgressPercent = useMemo(() => {
    if (!itunesProgress || itunesProgress.total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((itunesProgress.processed / itunesProgress.total) * 100));
  }, [itunesProgress]);

  const mainContentProps = useAppMainContentProps({
    activeView,
    activePlaylistId,
    statsRefreshSignal,
    songLookupById,
    setSongContextMenu,
    setErrorMessage,
    songsScrollRef,
    albumsScrollRef,
    albumDetailScrollRef,
    artistsScrollRef,
    artistAlbumsScrollRef,
    artistAlbumTracksScrollRef,
    playlistFolderScrollRef,
    statsScrollRef,
    settingsScrollRef,
    libraryController,
    playlistController,
    playbackController,
    navigationController,
    handleExportPlayStatsCsv,
    handleExportTagsCsv,
    handleExportHierarchyMd,
    onCheckForUpdates: appUpdate.checkForUpdatesManually,
    isCheckingForUpdates: appUpdate.isChecking,
    updateStatusText: appUpdate.statusText,
    crossfadeEnabled,
    crossfadeSeconds,
    setCrossfadeEnabled,
    setCrossfadeSeconds,
  });

  const dialogLayerProps = useAppDialogLayerProps({
    songContextMenu,
    contextMenuRef,
    contextMenuPos,
    playFromPlaylistIndex,
    playFromSongsIndex,
    addSongsToQueue,
    setClipboardSongIds,
    setClipboardHint,
    setSongContextMenu,
    setErrorMessage,
    refreshPlaylistTracks,
    activePlaylistId,
    clearSelection,
    isSearchPaletteOpen,
    selectedTagFilterIds,
    paletteLocalSongs,
    playlists,
    tags,
    setIsSearchPaletteOpen,
    handleExecuteSearchPaletteItem,
    currentPositionMs: usePlayerStore.getState().positionMs,
    importProgressPercent,
    metadataImportController,
  });

  const { title: headerTitle, subtitle: headerSubtitle } = getHeaderText({
    activeView,
    songCount,
    albumCount: albums.length,
    artistCount: artists.length,
    tagCount: tags.length,
    activePlaylist,
    activeFolderChildrenCount: activeFolderChildren.length,
    activePlaylistTrackCount,
  });

  return (
    <TooltipProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={(event) => {
          void handleDragEnd(event);
        }}
      >
        <div className="flex h-full min-h-0 flex-col text-text">
          <TransportBar
            currentSong={currentSong}
            queueLength={queueLength}
            songCount={songCount}
            upNextCount={upNext.length}
            isQueueHydrating={isQueueHydrating}
            queueRestoreProgress={restoreProgress}
            shuffleEnabled={shuffleEnabled}
            repeatMode={repeatMode}
            volume={persistedVolume}
            onPrevious={playPrevious}
            onTogglePlayback={() => {
              void handleTogglePlayback().catch((error: unknown) => setErrorMessage(String(error)));
            }}
            onNext={playNext}
            onToggleShuffle={handleToggleShuffle}
            onCycleRepeat={() => setRepeatMode(cycleRepeatMode(repeatMode))}
            onSeek={handleSeek}
            onToggleUpNext={() => {
              if (upNextOpen) closeUpNext();
              else openUpNext();
            }}
            onVolumeChange={(nextVolume) => {
              setPersistedVolume(nextVolume);
              void audioApi
                .setVolume(nextVolume)
                .catch((error: unknown) => setErrorMessage(String(error)));
            }}
            onVolumeScrub={(nextVolume) => {
              void audioApi
                .setVolume(nextVolume)
                .catch((error: unknown) => setErrorMessage(String(error)));
            }}
            onArtistClick={(artist) => {
              navigateToRoute({ kind: "artists-detail", artist });
            }}
            onAlbumClick={(album, albumArtist) => {
              navigateToRoute({
                kind: "albums-detail",
                album: { album, album_artist: albumArtist },
              });
            }}
            onSearchOpen={() => setIsSearchPaletteOpen(true)}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Group orientation="horizontal" className="h-full w-full">
              <Panel
                id="sidebar"
                defaultSize={`${sidebarSize}%`}
                minSize="16%"
                maxSize="35%"
                onResize={(size) => setSidebarSize(Math.round(size.asPercentage))}
                className="bg-surface-dark"
              >
                <AppSidebar
                  activeView={activeView}
                  playlists={playlists}
                  activePlaylistId={activePlaylistId}
                  isScanning={isScanning}
                  statusMessage={statusMessage}
                  errorMessage={errorMessage}
                  scanProgress={scanProgress}
                  progressPercent={progressPercent}
                  onNavigateSongs={() => {
                    navigateToRoute({ kind: "songs" });
                  }}
                  onNavigateAlbums={() => {
                    navigateToRoute({ kind: "albums-list" });
                  }}
                  onNavigateArtists={() => {
                    navigateToRoute({ kind: "artists-list" });
                  }}
                  onNavigateSettings={() => {
                    navigateToRoute({ kind: "settings" });
                  }}
                  onNavigateHistory={() => {
                    navigateToRoute({ kind: "history" });
                  }}
                  onNavigateStats={() => {
                    navigateToRoute({ kind: "stats" });
                  }}
                  onSelectPlaylist={(playlistId) => {
                    navigateToRoute(
                      {
                        kind: "playlist",
                        playlistId,
                      },
                      { playlistReorderMode: false },
                    );
                  }}
                  onCreatePlaylist={(parentId, name) => {
                    void handleCreatePlaylist(parentId, false, name, (playlistId) => {
                      navigateToRoute(
                        {
                          kind: "playlist",
                          playlistId,
                        },
                        { playlistReorderMode: false },
                      );
                    });
                  }}
                  onCreateFolder={(parentId, name) => {
                    void handleCreatePlaylist(parentId, true, name);
                  }}
                  onRenamePlaylist={(playlist, nextName) => {
                    void handleRenamePlaylist(playlist, nextName);
                  }}
                  onDeletePlaylist={(playlist) => {
                    void handleDeletePlaylist(playlist);
                  }}
                  onDuplicatePlaylist={(playlist) => {
                    void handleDuplicatePlaylist(playlist, (playlistId) => {
                      navigateToRoute(
                        {
                          kind: "playlist",
                          playlistId,
                        },
                        { playlistReorderMode: false },
                      );
                    });
                  }}
                  onExportM3u8={(playlist) => {
                    void handleExportPlaylistM3u8(playlist);
                  }}
                />
              </Panel>

              <Separator className="w-1 bg-transparent transition-colors hover:bg-leaf/40" />

              <Panel id="main" minSize="30%" className="bg-surface-dark">
                <main className="flex h-full min-h-0 flex-col bg-surface-dark">
                  <AppHeader
                    title={headerTitle}
                    subtitle={headerSubtitle}
                    canGoBack={pastStack.length > 0}
                    canGoForward={futureStack.length > 0}
                    onGoBack={goBack}
                    onGoForward={goForward}
                  />

                  <AppMainContent {...mainContentProps} />
                </main>
              </Panel>
              {upNextOpen && (
                <>
                  <Separator className="w-1 bg-transparent transition-colors hover:bg-leaf/40" />
                  <Panel
                    id="queue"
                    defaultSize="280px"
                    minSize="240px"
                    maxSize="400px"
                    className="bg-surface-dark"
                  >
                    <UpNextPanel
                      nowPlaying={currentSong}
                      upNext={upNext}
                      playingFrom={playingFrom}
                      playingFromLabel={playingFromLabel}
                      onClose={closeUpNext}
                      onRemoveUpNext={removeFromUpNext}
                    />
                  </Panel>
                </>
              )}
            </Group>
          </div>

          <AppDialogLayer {...dialogLayerProps} />
          <UpdateDialog {...appUpdate.dialogProps} />
        </div>

        <DragOverlay dropAnimation={null}>
          {dragOverlayCount > 0 ? (
            <div className="flex items-center gap-2 rounded-2xl bg-cloud px-3 py-2 shadow-xl">
              {dragOverlaySong ? (
                <>
                  <SongArtwork
                    artworkPath={dragOverlaySong.artworkPath}
                    sizeClassName="h-8 w-8"
                  />
                  <p className="text-sm font-medium">{dragOverlaySong.title}</p>
                </>
              ) : (
                <p className="text-sm font-medium">{dragOverlayLabel ?? "Dragging"}</p>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  );
}

export default App;
