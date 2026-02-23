import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BarChart2,
  Clock3,
  Disc3,
  Download,
  Library,
  LoaderCircle,
  Search,
  Settings2,
  Tags as TagsIcon,
  UserRound,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SongArtwork } from "./components/song-artwork";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { TooltipProvider } from "./components/ui/tooltip";
import { HistoryView } from "./features/history/HistoryView";
import { usePlayTracking } from "./features/history/usePlayTracking";
import { type ImportWizardStep, ItunesImportWizard } from "./features/import/ItunesImportWizard";
import { EditCommentDialog } from "./features/metadata/EditCommentDialog";
import { ManageTagsDialog } from "./features/metadata/ManageTagsDialog";
import { SetCustomStartDialog } from "./features/metadata/SetCustomStartDialog";
import { TransportBar } from "./features/player/TransportBar";
import { DraggableSongButton } from "./features/playlists/DraggableSongButton";
import { PlaylistSidebar } from "./features/playlists/PlaylistSidebar";
import { PlaylistView } from "./features/playlists/PlaylistView";
import { UpNextPanel } from "./features/queue/UpNextPanel";
import { StatsView } from "./features/stats/StatsView";
import { TagsSettingsPanel } from "./features/tags/TagsSettingsPanel";
import { audioApi, exportApi, libraryApi, mediaControlsApi, playlistApi, tagsApi } from "./lib/api";
import { cn } from "./lib/utils";
import { usePlayerStore } from "./stores/player-store";
import { usePlaylistStore } from "./stores/playlist-store";
import { useQueueStore } from "./stores/queue-store";
import { useSessionStore } from "./stores/session-store";
import type {
  AlbumListItem,
  ArtistListItem,
  AudioErrorEvent,
  AudioPositionEvent,
  AudioStateEvent,
  AudioTrackEndedEvent,
  DragPlaylistPayload,
  DragSongPayload,
  ItunesImportOptions,
  ItunesImportProgress,
  ItunesImportSummary,
  ItunesPreview,
  LibraryFileChangedEvent,
  LibrarySearchResult,
  PlaylistNode,
  PlaylistTrackItem,
  RepeatMode,
  ScanProgressEvent,
  SongListItem,
  SongSortField,
  SortOrder,
  Tag,
} from "./types";

const SONG_PAGE_SIZE = 250;
const PLAYLIST_PAGE_SIZE = 250;
const SONG_ROW_HEIGHT = 54;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_RESULT_LIMIT = 20;
const PERF_TRACE_ENABLED = (() => {
  const rawValue = String(import.meta.env.VITE_PERF_TRACE ?? "").toLowerCase();
  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
})();

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function nextSort(currentField: SongSortField, currentOrder: SortOrder, field: SongSortField) {
  if (currentField === field) {
    return currentOrder === "asc" ? "desc" : "asc";
  }
  return "asc";
}

function cycleRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === "off") {
    return "all";
  }
  if (mode === "all") {
    return "one";
  }
  return "off";
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

function parsePlaylistNodeId(id: string): string | null {
  if (!id.startsWith("playlist-node:")) {
    return null;
  }
  return id.replace("playlist-node:", "");
}

function parsePlaylistDropId(id: string): string | null {
  if (!id.startsWith("playlist-tracks-drop:")) {
    return null;
  }
  return id.replace("playlist-tracks-drop:", "");
}

function parsePlaylistTrackId(id: string): string | null {
  if (!id.startsWith("playlist-track:")) {
    return null;
  }
  return id.replace("playlist-track:", "");
}

function parseQueueSongId(id: string): string | null {
  if (!id.startsWith("queue-song:")) {
    return null;
  }
  return id.replace("queue-song:", "");
}

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState("Choose a music folder to start scanning.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [songCount, setSongCount] = useState(0);
  const [songsByIndex, setSongsByIndex] = useState<Record<number, SongListItem>>({});

  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [artists, setArtists] = useState<ArtistListItem[]>([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(false);
  const [isLoadingArtists, setIsLoadingArtists] = useState(false);

  const [selectedAlbum, setSelectedAlbum] = useState<AlbumListItem | null>(null);
  const [albumTracks, setAlbumTracks] = useState<SongListItem[]>([]);
  const [loadingAlbumTracks, setLoadingAlbumTracks] = useState(false);

  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [artistAlbums, setArtistAlbums] = useState<AlbumListItem[]>([]);
  const [selectedArtistAlbum, setSelectedArtistAlbum] = useState<AlbumListItem | null>(null);
  const [artistAlbumTracks, setArtistAlbumTracks] = useState<SongListItem[]>([]);
  const [loadingArtistAlbums, setLoadingArtistAlbums] = useState(false);
  const [loadingArtistAlbumTracks, setLoadingArtistAlbumTracks] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LibrarySearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagFilterIds, setSelectedTagFilterIds] = useState<string[]>([]);
  const [showTagFilterMenu, setShowTagFilterMenu] = useState(false);

  const [songContextMenu, setSongContextMenu] = useState<{
    x: number;
    y: number;
    songIds: string[];
    index: number;
    source: "library" | "playlist";
  } | null>(null);
  const [metadataTargetSongIds, setMetadataTargetSongIds] = useState<string[]>([]);
  const [showManageTagsDialog, setShowManageTagsDialog] = useState(false);
  const [manageTagsSelection, setManageTagsSelection] = useState<string[]>([]);
  const [manageTagsBaseline, setManageTagsBaseline] = useState<string[]>([]);
  const [showEditCommentDialog, setShowEditCommentDialog] = useState(false);
  const [showCustomStartDialog, setShowCustomStartDialog] = useState(false);

  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importWizardStep, setImportWizardStep] = useState<ImportWizardStep>(1);
  const [itunesXmlPath, setItunesXmlPath] = useState("");
  const [itunesPreview, setItunesPreview] = useState<ItunesPreview | null>(null);
  const [itunesOptions, setItunesOptions] = useState<ItunesImportOptions>({
    import_play_counts: true,
    import_ratings: true,
    import_comments: true,
    import_playlists: true,
  });
  const [itunesProgress, setItunesProgress] = useState<ItunesImportProgress | null>(null);
  const [itunesSummary, setItunesSummary] = useState<ItunesImportSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [queueSourceSongs, setQueueSourceSongs] = useState<SongListItem[]>([]);
  const [queueSourceLabel, setQueueSourceLabel] = useState<string | null>(null);
  const [dragOverlayLabel, setDragOverlayLabel] = useState<string | null>(null);
  const [dragOverlayCount, setDragOverlayCount] = useState(0);
  const [clipboardHint, setClipboardHint] = useState<string | null>(null);

  const sidebarSize = useSessionStore((state) => state.sidebarSize);
  const setSidebarSize = useSessionStore((state) => state.setSidebarSize);
  const persistedVolume = useSessionStore((state) => state.volume);
  const setPersistedVolume = useSessionStore((state) => state.setVolume);

  const activeView = useSessionStore((state) => state.activeView);
  const setActiveView = useSessionStore((state) => state.setActiveView);
  const activePlaylistId = useSessionStore((state) => state.activePlaylistId);
  const setActivePlaylistId = useSessionStore((state) => state.setActivePlaylistId);

  const queueSongIds = useSessionStore((state) => state.queueSongIds);
  const queueCurrentIndex = useSessionStore((state) => state.queueCurrentIndex);
  const setQueueSongIds = useSessionStore((state) => state.setQueueSongIds);
  const setQueueCurrentIndex = useSessionStore((state) => state.setQueueCurrentIndex);
  const repeatMode = useSessionStore((state) => state.repeatMode);
  const setRepeatMode = useSessionStore((state) => state.setRepeatMode);
  const shuffleEnabled = useSessionStore((state) => state.shuffleEnabled);
  const setShuffleEnabled = useSessionStore((state) => state.setShuffleEnabled);

  const songSort = useSessionStore((state) => state.songSort);
  const songOrder = useSessionStore((state) => state.songOrder);
  const setSongSort = useSessionStore((state) => state.setSongSort);

  const albumSort = useSessionStore((state) => state.albumSort);
  const albumOrder = useSessionStore((state) => state.albumOrder);
  const artistSort = useSessionStore((state) => state.artistSort);
  const artistOrder = useSessionStore((state) => state.artistOrder);

  const queue = usePlayerStore((state) => state.queue);
  const nowPlaying = usePlayerStore((state) => state.nowPlaying);
  const currentIndex = usePlayerStore((state) => state.currentIndex);

  const setSongs = usePlayerStore((state) => state.setSongs);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlaying = usePlayerStore((state) => state.setNowPlaying);
  const setCurrentIndex = usePlayerStore((state) => state.setCurrentIndex);
  const setPlaybackState = usePlayerStore((state) => state.setPlaybackState);
  const setPosition = usePlayerStore((state) => state.setPosition);

  const playlists = usePlaylistStore((state) => state.playlists);
  const setPlaylists = usePlaylistStore((state) => state.setPlaylists);
  const tracksByPlaylistId = usePlaylistStore((state) => state.tracksByPlaylistId);
  const trackCountsByPlaylistId = usePlaylistStore((state) => state.trackCountsByPlaylistId);
  const tracksPageByPlaylistId = usePlaylistStore((state) => state.tracksPageByPlaylistId);
  const loadedPagesByPlaylistId = usePlaylistStore((state) => state.loadedPagesByPlaylistId);
  const setPlaylistTrackCount = usePlaylistStore((state) => state.setPlaylistTrackCount);
  const setPlaylistTracksPage = usePlaylistStore((state) => state.setPlaylistTracksPage);
  const setPlaylistPageLoading = usePlaylistStore((state) => state.setPlaylistPageLoading);
  const invalidatePlaylistCache = usePlaylistStore((state) => state.invalidatePlaylistCache);
  const invalidatePlaylistsCache = usePlaylistStore((state) => state.invalidatePlaylistsCache);
  const removePlaylistFromStore = usePlaylistStore((state) => state.removePlaylist);
  const selectedSongIds = usePlaylistStore((state) => state.selectedSongIds);
  const selectSongs = usePlaylistStore((state) => state.selectSongs);
  const clearSelection = usePlaylistStore((state) => state.clearSelection);
  const clipboardSongIds = usePlaylistStore((state) => state.clipboardSongIds);
  const copySelectionToClipboard = usePlaylistStore((state) => state.copySelectionToClipboard);
  const setClipboardSongIds = usePlaylistStore((state) => state.setClipboardSongIds);
  const clearClipboard = usePlaylistStore((state) => state.clearClipboard);

  const upNext = useQueueStore((state) => state.upNext);
  const playingFromSource = useQueueStore((state) => state.playingFromSource);
  const playingFromIndex = useQueueStore((state) => state.playingFromIndex);
  const playingFromLabel = useQueueStore((state) => state.playingFromLabel);
  const enqueueSongs = useQueueStore((state) => state.enqueueSongs);
  const reorderUpNext = useQueueStore((state) => state.reorderUpNext);
  const removeFromUpNext = useQueueStore((state) => state.removeFromUpNext);
  const shiftNextSong = useQueueStore((state) => state.shiftNextSong);
  const setPlayingFrom = useQueueStore((state) => state.setPlayingFrom);
  const upNextOpen = useQueueStore((state) => state.isOpen);
  const openUpNext = useQueueStore((state) => state.open);
  const closeUpNext = useQueueStore((state) => state.close);
  const playingFrom = useMemo(
    () => playingFromSource.slice(playingFromIndex, playingFromIndex + 50),
    [playingFromIndex, playingFromSource],
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const songsScrollRef = useRef<HTMLDivElement | null>(null);
  const albumsScrollRef = useRef<HTMLDivElement | null>(null);
  const artistsScrollRef = useRef<HTMLDivElement | null>(null);
  const tagFilterMenuRootRef = useRef<HTMLDivElement | null>(null);
  const watcherRefreshTimeoutRef = useRef<number | null>(null);
  const activePlaylistRequestIdRef = useRef(0);
  const perfPlaylistOpenRef = useRef<{ playlistId: string; startedAt: number } | null>(null);
  const perfPlayRequestRef = useRef<{ songId: string; startedAt: number } | null>(null);
  const perfViewSwitchRef = useRef<{ view: string; startedAt: number } | null>(null);

  const [albumGridWidth, setAlbumGridWidth] = useState(920);
  const [playlistReorderMode, setPlaylistReorderMode] = useState(false);
  const [songsOrderedIds, setSongsOrderedIds] = useState<string[]>([]);
  const [playlistTrackIdsByPlaylistId, setPlaylistTrackIdsByPlaylistId] = useState<
    Record<string, string[]>
  >({});
  const [statsRefreshSignal, setStatsRefreshSignal] = useState(0);

  const { onSongStarted, onPositionUpdate, onPaused, onResumed, onTrackEnded } = usePlayTracking();
  const triggerStatsRefresh = useCallback(() => {
    setStatsRefreshSignal((current) => current + 1);
  }, []);

  const loadedSongPagesRef = useRef<Set<number>>(new Set());
  const loadingSongPagesRef = useRef<Set<number>>(new Set());

  const songVirtualizer = useVirtualizer({
    count: songCount,
    getScrollElement: () => songsScrollRef.current,
    estimateSize: () => SONG_ROW_HEIGHT,
    overscan: 16,
  });

  const albumColumns = Math.max(1, Math.floor(albumGridWidth / 220));
  const albumRowCount = Math.ceil(albums.length / albumColumns);

  const albumsVirtualizer = useVirtualizer({
    count: albumRowCount,
    getScrollElement: () => albumsScrollRef.current,
    estimateSize: () => 250,
    overscan: 4,
  });

  const artistsVirtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => artistsScrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === activePlaylistId) ?? null,
    [activePlaylistId, playlists],
  );
  const activePlaylistTrackIds = useMemo(
    () => (activePlaylistId ? (playlistTrackIdsByPlaylistId[activePlaylistId] ?? []) : []),
    [activePlaylistId, playlistTrackIdsByPlaylistId],
  );
  const activePlaylistTrackCount = useMemo(() => {
    if (!activePlaylistId) {
      return 0;
    }
    return trackCountsByPlaylistId[activePlaylistId] ?? activePlaylistTrackIds.length;
  }, [activePlaylistId, activePlaylistTrackIds.length, trackCountsByPlaylistId]);
  const activePlaylistTracksByIndex = useMemo(() => {
    if (!activePlaylistId) {
      return [] as Array<PlaylistTrackItem | undefined>;
    }

    const sparse = Array<PlaylistTrackItem | undefined>(activePlaylistTrackCount).fill(undefined);
    const pages = tracksPageByPlaylistId[activePlaylistId] ?? {};
    for (const [pageValue, tracks] of Object.entries(pages)) {
      const page = Number(pageValue);
      if (!Number.isFinite(page) || page < 0) {
        continue;
      }
      const baseIndex = page * PLAYLIST_PAGE_SIZE;
      for (let index = 0; index < tracks.length; index += 1) {
        sparse[baseIndex + index] = tracks[index];
      }
    }

    if (Object.keys(pages).length === 0) {
      const fallback = tracksByPlaylistId[activePlaylistId] ?? [];
      for (let index = 0; index < fallback.length; index += 1) {
        sparse[index] = fallback[index];
      }
    }

    return sparse;
  }, [activePlaylistId, activePlaylistTrackCount, tracksByPlaylistId, tracksPageByPlaylistId]);
  const activePlaylistLoadedTracks = useMemo(
    () => activePlaylistTracksByIndex.filter((track): track is PlaylistTrackItem => Boolean(track)),
    [activePlaylistTracksByIndex],
  );
  const selectedSongIdSet = useMemo(() => new Set(selectedSongIds), [selectedSongIds]);
  const songLookupById = useMemo(() => {
    const lookup = new Map<string, SongListItem>();
    for (const song of Object.values(songsByIndex)) {
      lookup.set(song.id, song);
    }
    for (const song of queue) {
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
  }, [
    activePlaylistLoadedTracks,
    albumTracks,
    artistAlbumTracks,
    queue,
    searchResults,
    songsByIndex,
  ]);
  const metadataTargetSongs = useMemo(
    () =>
      metadataTargetSongIds
        .map((songId) => songLookupById.get(songId))
        .filter((song): song is SongListItem => Boolean(song)),
    [metadataTargetSongIds, songLookupById],
  );
  const tracePerf = useCallback((label: string, startedAt: number, extra?: string) => {
    if (!PERF_TRACE_ENABLED) {
      return;
    }
    const elapsedMs = performance.now() - startedAt;
    console.debug(`[perf] ${label} ${elapsedMs.toFixed(1)}ms${extra ? ` (${extra})` : ""}`);
  }, []);

  const resetSongPages = useCallback(() => {
    loadedSongPagesRef.current.clear();
    loadingSongPagesRef.current.clear();
    setSongsByIndex({});
    setSongsOrderedIds([]);
  }, []);

  const persistQueue = useCallback(
    (nextQueue: SongListItem[], nextIndex: number | null, persistSongIds = true) => {
      if (persistSongIds) {
        setQueueSongIds(nextQueue.map((song) => song.id));
      }
      setQueueCurrentIndex(nextIndex);
    },
    [setQueueCurrentIndex, setQueueSongIds],
  );

  const refreshSongCount = useCallback(async () => {
    const count = await libraryApi.getSongCount(selectedTagFilterIds);
    const totalSongCount =
      selectedTagFilterIds.length > 0 ? await libraryApi.getSongCount() : count;
    setSongCount(count);

    if (count === 0 && totalSongCount === 0) {
      setStatusMessage("No songs found yet. Scan a folder to begin.");
      setSongs([]);
      setQueue([], null);
      setNowPlaying(null);
      setCurrentIndex(null);
      setPlaybackState("stopped");
      setPosition(0, 0);
      persistQueue([], null);
    } else if (count === 0 && selectedTagFilterIds.length > 0) {
      setStatusMessage("No songs match the current tag filters.");
    } else {
      if (selectedTagFilterIds.length > 0) {
        setStatusMessage(
          `Loaded ${count.toLocaleString()} song(s) matching ${selectedTagFilterIds.length} tag filter(s).`,
        );
      } else {
        setStatusMessage(`Loaded ${count.toLocaleString()} song(s).`);
      }
    }

    return count;
  }, [
    persistQueue,
    setCurrentIndex,
    setNowPlaying,
    setPlaybackState,
    setPosition,
    setQueue,
    setSongs,
    selectedTagFilterIds,
  ]);

  const ensureSongPage = useCallback(
    async (page: number) => {
      if (page < 0) {
        return;
      }

      if (loadedSongPagesRef.current.has(page) || loadingSongPagesRef.current.has(page)) {
        return;
      }

      loadingSongPagesRef.current.add(page);
      try {
        const offset = page * SONG_PAGE_SIZE;
        const chunk = await libraryApi.getSongs({
          limit: SONG_PAGE_SIZE,
          offset,
          sort: songSort,
          order: songOrder,
          tagIds: selectedTagFilterIds,
        });

        setSongsByIndex((previous) => {
          const next = { ...previous };
          for (let index = 0; index < chunk.length; index += 1) {
            next[offset + index] = chunk[index];
          }
          return next;
        });
        setSongsOrderedIds((previous) => {
          const next = [...previous];
          for (let index = 0; index < chunk.length; index += 1) {
            next[offset + index] = chunk[index].id;
          }
          return next;
        });

        loadedSongPagesRef.current.add(page);

        if (page === 0) {
          setSongs(chunk);
        }
      } finally {
        loadingSongPagesRef.current.delete(page);
      }
    },
    [selectedTagFilterIds, setSongs, songOrder, songSort],
  );

  const loadAllSongsForCurrentSort = useCallback(async () => {
    const total = await libraryApi.getSongCount(selectedTagFilterIds);
    const result: SongListItem[] = [];
    let offset = 0;

    while (offset < total) {
      const chunk = await libraryApi.getSongs({
        limit: SONG_PAGE_SIZE,
        offset,
        sort: songSort,
        order: songOrder,
        tagIds: selectedTagFilterIds,
      });
      if (chunk.length === 0) {
        break;
      }
      result.push(...chunk);
      offset += chunk.length;
    }

    return result;
  }, [selectedTagFilterIds, songOrder, songSort]);

  const refreshAlbums = useCallback(async () => {
    setIsLoadingAlbums(true);
    try {
      const result = await libraryApi.getAlbums({
        limit: 5000,
        offset: 0,
        sort: albumSort,
        order: albumOrder,
      });
      setAlbums(result);
    } finally {
      setIsLoadingAlbums(false);
    }
  }, [albumOrder, albumSort]);

  const refreshArtists = useCallback(async () => {
    setIsLoadingArtists(true);
    try {
      const result = await libraryApi.getArtists({
        limit: 5000,
        offset: 0,
        sort: artistSort,
        order: artistOrder,
      });
      setArtists(result);
    } finally {
      setIsLoadingArtists(false);
    }
  }, [artistOrder, artistSort]);

  const refreshTags = useCallback(async () => {
    const result = await tagsApi.list();
    setTags(result);
  }, []);

  const replaceQueueAndPlay = useCallback(
    async (nextQueue: SongListItem[], startIndex: number, startMs?: number) => {
      if (startIndex < 0 || startIndex >= nextQueue.length) {
        return;
      }

      const song = nextQueue[startIndex];
      setQueue(nextQueue, startIndex);
      persistQueue(nextQueue, startIndex);
      setCurrentIndex(startIndex);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);

      perfPlayRequestRef.current = { songId: song.id, startedAt: performance.now() };
      await audioApi.play(song.id, startMs);
      onSongStarted(song);
      triggerStatsRefresh();
      setErrorMessage(null);
      setPlayingFrom(nextQueue, queueSourceLabel, startIndex + 1);
    },
    [
      onSongStarted,
      persistQueue,
      queueSourceLabel,
      setCurrentIndex,
      setNowPlaying,
      setPlaybackState,
      setPlayingFrom,
      setPosition,
      setQueue,
      triggerStatsRefresh,
    ],
  );

  const playSong = useCallback(
    async (song: SongListItem, startMs?: number) => {
      perfPlayRequestRef.current = { songId: song.id, startedAt: performance.now() };
      await audioApi.play(song.id, startMs);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      onSongStarted(song);
      triggerStatsRefresh();
    },
    [setNowPlaying, setPlaybackState, setPosition, onSongStarted, triggerStatsRefresh],
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
    [persistQueue, playSong, queue, queueSourceLabel, setCurrentIndex, setPlayingFrom],
  );

  const playNext = useCallback(() => {
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

    void playQueueIndex(currentIndex + 1).catch((error: unknown) => setErrorMessage(String(error)));
  }, [
    currentIndex,
    nowPlaying,
    playQueueIndex,
    playSong,
    queue.length,
    repeatMode,
    setPlaybackState,
    shiftNextSong,
  ]);

  const playPrevious = useCallback(() => {
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

    void playQueueIndex(currentIndex - 1).catch((error: unknown) => setErrorMessage(String(error)));
  }, [currentIndex, playQueueIndex, queue.length, repeatMode, setPosition]);

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

  const openAlbum = useCallback(async (album: AlbumListItem) => {
    setSelectedAlbum(album);
    setLoadingAlbumTracks(true);
    setAlbumTracks([]);

    try {
      const tracks = await libraryApi.getAlbumTracks({
        album: album.album,
        albumArtist: album.album_artist,
      });
      setAlbumTracks(tracks);
    } finally {
      setLoadingAlbumTracks(false);
    }
  }, []);

  const openArtist = useCallback(async (artist: string) => {
    setSelectedArtist(artist);
    setSelectedArtistAlbum(null);
    setArtistAlbumTracks([]);
    setLoadingArtistAlbums(true);

    try {
      const nextAlbums = await libraryApi.getArtistAlbums(artist);
      setArtistAlbums(nextAlbums);
    } finally {
      setLoadingArtistAlbums(false);
    }
  }, []);

  const openArtistAlbum = useCallback(async (album: AlbumListItem) => {
    setSelectedArtistAlbum(album);
    setLoadingArtistAlbumTracks(true);
    setArtistAlbumTracks([]);

    try {
      const tracks = await libraryApi.getAlbumTracks({
        album: album.album,
        albumArtist: album.album_artist,
      });
      setArtistAlbumTracks(tracks);
    } finally {
      setLoadingArtistAlbumTracks(false);
    }
  }, []);

  const refreshPlaylists = useCallback(async () => {
    const result = await playlistApi.list();
    setPlaylists(result);
  }, [setPlaylists]);

  const handleCreateTag = useCallback(
    async (name: string, color: string) => {
      try {
        await tagsApi.create(name, color);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags],
  );

  const handleRenameTag = useCallback(
    async (tag: Tag) => {
      const nextName = window.prompt("Rename tag", tag.name);
      if (nextName === null) {
        return;
      }
      try {
        await tagsApi.rename(tag.id, nextName);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags],
  );

  const handleSetTagColor = useCallback(
    async (tag: Tag) => {
      const nextColor = window.prompt("Set tag color (#RRGGBB)", tag.color);
      if (nextColor === null) {
        return;
      }
      try {
        await tagsApi.setColor(tag.id, nextColor);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags],
  );

  const handleDeleteTag = useCallback(
    async (tag: Tag) => {
      const confirmed = window.confirm(`Delete tag "${tag.name}"?`);
      if (!confirmed) {
        return;
      }
      try {
        await tagsApi.delete(tag.id);
        setSelectedTagFilterIds((previous) => previous.filter((value) => value !== tag.id));
        await refreshTags();
        await refreshSongCount().then(() => ensureSongPage(0));
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [ensureSongPage, refreshSongCount, refreshTags],
  );

  const ensurePlaylistPage = useCallback(
    async (playlistId: string, page: number, requestId = activePlaylistRequestIdRef.current) => {
      if (page < 0) {
        return;
      }

      const playlistState = usePlaylistStore.getState();
      const loadedPages = playlistState.loadedPagesByPlaylistId[playlistId] ?? [];
      const loadingPages = playlistState.loadingPagesByPlaylistId[playlistId] ?? [];
      if (loadedPages.includes(page) || loadingPages.includes(page)) {
        return;
      }

      setPlaylistPageLoading(playlistId, page, true);
      try {
        const result = await playlistApi.getTrackPage({
          playlistId,
          limit: PLAYLIST_PAGE_SIZE,
          offset: page * PLAYLIST_PAGE_SIZE,
        });

        if (requestId !== activePlaylistRequestIdRef.current) {
          return;
        }

        setPlaylistTracksPage(playlistId, page, result.tracks);

        const openPerf = perfPlaylistOpenRef.current;
        if (openPerf && openPerf.playlistId === playlistId && page === 0) {
          tracePerf("playlist.open.rows-visible", openPerf.startedAt, playlistId);
          perfPlaylistOpenRef.current = null;
        }
      } finally {
        setPlaylistPageLoading(playlistId, page, false);
      }
    },
    [setPlaylistPageLoading, setPlaylistTracksPage, tracePerf],
  );

  const requestPlaylistTrackRange = useCallback(
    (playlistId: string, startIndex: number, endIndex: number) => {
      const firstPage = Math.floor(Math.max(0, startIndex) / PLAYLIST_PAGE_SIZE);
      const lastPage = Math.floor(Math.max(0, endIndex) / PLAYLIST_PAGE_SIZE);
      for (let page = firstPage - 1; page <= lastPage + 1; page += 1) {
        if (page >= 0) {
          void ensurePlaylistPage(playlistId, page);
        }
      }
    },
    [ensurePlaylistPage],
  );

  const refreshPlaylistTracks = useCallback(
    async (playlistId: string, requestId = activePlaylistRequestIdRef.current) => {
      const startedAt = performance.now();
      const [trackCount, trackIds] = await Promise.all([
        playlistApi.getTrackCount(playlistId),
        playlistApi.getTrackIds(playlistId),
      ]);
      if (requestId !== activePlaylistRequestIdRef.current) {
        return;
      }

      invalidatePlaylistCache(playlistId);
      setPlaylistTrackCount(playlistId, trackCount);
      setPlaylistTrackIdsByPlaylistId((previous) => ({
        ...previous,
        [playlistId]: trackIds.songIds,
      }));

      await ensurePlaylistPage(playlistId, 0, requestId);
      void ensurePlaylistPage(playlistId, 1, requestId);
      if (playlistReorderMode && activePlaylistId === playlistId) {
        const totalPages = Math.ceil(trackCount / PLAYLIST_PAGE_SIZE);
        for (let page = 2; page < totalPages; page += 1) {
          void ensurePlaylistPage(playlistId, page, requestId);
        }
      }
      tracePerf("playlist.refresh", startedAt, playlistId);
    },
    [
      activePlaylistId,
      ensurePlaylistPage,
      invalidatePlaylistCache,
      playlistReorderMode,
      setPlaylistTrackCount,
      tracePerf,
    ],
  );

  const openPlaylist = useCallback(
    (playlistId: string) => {
      const startedAt = performance.now();
      perfViewSwitchRef.current = { view: "playlist", startedAt };
      perfPlaylistOpenRef.current = { playlistId, startedAt };
      setPlaylistReorderMode(false);
      setActiveView("playlist");
      setActivePlaylistId(playlistId);
      setSelectedAlbum(null);
      setSelectedArtist(null);
      clearSelection();
    },
    [clearSelection, setActivePlaylistId, setActiveView],
  );

  const handleCreatePlaylist = useCallback(
    async (parentId: string | null, isFolder: boolean) => {
      const defaultName = isFolder ? "New Folder" : "New Playlist";
      const name = window.prompt(isFolder ? "Folder name" : "Playlist name", defaultName);
      if (name === null) {
        return;
      }

      try {
        const created = await playlistApi.create({
          name,
          parentId,
          isFolder,
        });
        await refreshPlaylists();
        if (!created.is_folder) {
          openPlaylist(created.id);
        }
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [openPlaylist, refreshPlaylists],
  );

  const handleRenamePlaylist = useCallback(
    async (playlist: PlaylistNode) => {
      const nextName = window.prompt("Rename", playlist.name);
      if (nextName === null) {
        return;
      }

      try {
        await playlistApi.rename(playlist.id, nextName);
        await refreshPlaylists();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshPlaylists],
  );

  const handleDeletePlaylist = useCallback(
    async (playlist: PlaylistNode) => {
      const confirmed = window.confirm(`Delete "${playlist.name}"?`);
      if (!confirmed) {
        return;
      }

      try {
        await playlistApi.delete(playlist.id);
        removePlaylistFromStore(playlist.id);
        setPlaylistTrackIdsByPlaylistId((previous) => {
          const next = { ...previous };
          delete next[playlist.id];
          return next;
        });
        if (activePlaylistId === playlist.id) {
          setActivePlaylistId(null);
          setActiveView("songs");
        }
        await refreshPlaylists();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [
      activePlaylistId,
      refreshPlaylists,
      removePlaylistFromStore,
      setActivePlaylistId,
      setActiveView,
    ],
  );

  const handleDuplicatePlaylist = useCallback(
    async (playlist: PlaylistNode) => {
      if (playlist.is_folder) {
        return;
      }

      try {
        const duplicated = await playlistApi.duplicate(playlist.id);
        invalidatePlaylistsCache([duplicated.id]);
        await refreshPlaylists();
        openPlaylist(duplicated.id);
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [invalidatePlaylistsCache, openPlaylist, refreshPlaylists],
  );

  const handleExportPlaylistM3u8 = useCallback(async (playlist: PlaylistNode) => {
    if (playlist.is_folder) return;
    const filePath = await save({
      defaultPath: `${playlist.name}.m3u8`,
      filters: [{ name: "M3U8 Playlist", extensions: ["m3u8"] }],
    });
    if (!filePath) return;
    try {
      await exportApi.playlistM3u8(playlist.id, filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, []);

  const handleExportPlayStatsCsv = useCallback(async () => {
    const filePath = await save({
      defaultPath: "play-stats.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    try {
      await exportApi.playStatsCsv(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, []);

  const handleExportTagsCsv = useCallback(async () => {
    const filePath = await save({
      defaultPath: "tags.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    try {
      await exportApi.tagsCsv(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, []);

  const handleExportHierarchyMd = useCallback(async () => {
    const filePath = await save({
      defaultPath: "library-hierarchy.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!filePath) return;
    try {
      await exportApi.libraryHierarchyMd(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, []);

  const addSongsToQueue = useCallback(
    (songIds: string[]) => {
      const uniqueIds = Array.from(new Set(songIds));
      const resolvedSongs = uniqueIds
        .map((songId) => songLookupById.get(songId))
        .filter((song): song is SongListItem => Boolean(song));
      enqueueSongs(resolvedSongs);
    },
    [enqueueSongs, songLookupById],
  );

  const openManageTagsForSongs = useCallback(
    async (songIds: string[]) => {
      const deduped = Array.from(new Set(songIds));
      if (deduped.length === 0) {
        return;
      }

      let targetSongs = deduped
        .map((songId) => songLookupById.get(songId))
        .filter((song): song is SongListItem => Boolean(song));

      try {
        const freshSongs = await libraryApi.getSongsByIds(deduped);
        if (freshSongs.length > 0) {
          targetSongs = freshSongs;
        }
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }

      if (targetSongs.length === 0) {
        return;
      }

      const firstSongTagIds = targetSongs[0]?.tags.map((tag) => tag.id) ?? [];
      const baseline = firstSongTagIds.filter((tagId) =>
        targetSongs.every((song) => song.tags.some((tag) => tag.id === tagId)),
      );

      setMetadataTargetSongIds(deduped);
      setManageTagsBaseline(baseline);
      setManageTagsSelection(baseline);
      setShowManageTagsDialog(true);
    },
    [songLookupById],
  );

  const applyManageTags = async () => {
    if (metadataTargetSongIds.length === 0) {
      return;
    }

    const baselineSet = new Set(manageTagsBaseline);
    const selectedSet = new Set(manageTagsSelection);
    const tagsToAssign = manageTagsSelection.filter((tagId) => !baselineSet.has(tagId));
    const tagsToRemove = manageTagsBaseline.filter((tagId) => !selectedSet.has(tagId));

    try {
      if (tagsToAssign.length > 0) {
        await tagsApi.assign(metadataTargetSongIds, tagsToAssign);
      }
      if (tagsToRemove.length > 0) {
        await tagsApi.remove(metadataTargetSongIds, tagsToRemove);
      }
      setShowManageTagsDialog(false);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  };

  const applySongComment = async (comment: string | null) => {
    if (metadataTargetSongIds.length === 0) {
      return;
    }
    try {
      await Promise.all(
        metadataTargetSongIds.map((songId) => libraryApi.updateSongComment(songId, comment)),
      );
      setShowEditCommentDialog(false);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  };

  const applyCustomStart = async (customStartMs: number) => {
    if (metadataTargetSongIds.length === 0) {
      return;
    }
    try {
      await Promise.all(
        metadataTargetSongIds.map((songId) => libraryApi.setSongCustomStart(songId, customStartMs)),
      );
      setShowCustomStartDialog(false);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  };

  const handlePlaylistTrackSelection = useCallback(
    (
      songId: string,
      songIndex: number,
      modifiers: {
        shiftKey: boolean;
        metaKey: boolean;
      },
    ) => {
      const orderedSongIds = activePlaylistTrackIds;
      if (modifiers.shiftKey) {
        selectSongs({
          songId,
          songIndex,
          orderedSongIds,
          mode: "range",
        });
        return;
      }

      if (modifiers.metaKey) {
        selectSongs({
          songId,
          songIndex,
          orderedSongIds,
          mode: "toggle",
        });
        return;
      }

      selectSongs({
        songId,
        songIndex,
        orderedSongIds,
        mode: "single",
      });
    },
    [activePlaylistTrackIds, selectSongs],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current;
      if (!data) {
        return;
      }

      const payload = data as DragSongPayload | DragPlaylistPayload;
      if (payload.type === "song") {
        const count = payload.songIds.length;
        setDragOverlayCount(count);
        setDragOverlayLabel(count === 1 ? "1 song" : `${count} songs`);
        return;
      }

      const playlistPayload = payload as DragPlaylistPayload;
      const node = playlists.find((playlist) => playlist.id === playlistPayload.playlistId);
      setDragOverlayCount(1);
      setDragOverlayLabel(node?.name ?? "Playlist");
    },
    [playlists],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setDragOverlayCount(0);
      setDragOverlayLabel(null);

      if (!event.over) {
        return;
      }

      const activeId = String(event.active.id);
      const overId = String(event.over.id);
      const activeData = event.active.data.current as
        | DragSongPayload
        | DragPlaylistPayload
        | undefined;
      if (!activeData) {
        return;
      }

      if ((activeData as DragPlaylistPayload).type === "playlist-node") {
        const movedId = parsePlaylistNodeId(activeId);
        if (!movedId) {
          return;
        }

        let newParentId: string | null = null;
        let newIndex = 0;
        if (overId === "playlist-root") {
          const siblings = playlists
            .filter((playlist) => playlist.parent_id === null && playlist.id !== movedId)
            .sort((a, b) => a.sort_order - b.sort_order);
          newParentId = null;
          newIndex = siblings.length;
        } else {
          const overNodeId = parsePlaylistNodeId(overId);
          if (!overNodeId) {
            return;
          }

          const overNode = playlists.find((playlist) => playlist.id === overNodeId);
          if (!overNode) {
            return;
          }

          if (overNode.is_folder) {
            newParentId = overNode.id;
            newIndex = playlists.filter((playlist) => playlist.parent_id === overNode.id).length;
          } else {
            newParentId = overNode.parent_id;
            const siblings = playlists
              .filter(
                (playlist) => playlist.parent_id === overNode.parent_id && playlist.id !== movedId,
              )
              .sort((a, b) => a.sort_order - b.sort_order);
            const overIndex = siblings.findIndex((playlist) => playlist.id === overNode.id);
            newIndex = overIndex < 0 ? siblings.length : overIndex + 1;
          }
        }

        try {
          await playlistApi.move({
            id: movedId,
            newParentId,
            newIndex,
          });
          await refreshPlaylists();
        } catch (error: unknown) {
          setErrorMessage(String(error));
        }
        return;
      }

      const songPayload = activeData as DragSongPayload;
      const draggedSongIds = Array.from(new Set(songPayload.songIds));

      if (overId === "queue-dropzone") {
        addSongsToQueue(draggedSongIds);
        return;
      }

      const overQueueSongId = parseQueueSongId(overId);
      if (overQueueSongId && songPayload.source === "queue") {
        const currentOrder = upNext.map((song) => song.id);
        const activeQueueSongId = parseQueueSongId(activeId);
        if (!activeQueueSongId) {
          return;
        }
        const oldIndex = currentOrder.indexOf(activeQueueSongId);
        const newIndex = currentOrder.indexOf(overQueueSongId);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
          return;
        }
        const reordered = arrayMove(currentOrder, oldIndex, newIndex);
        reorderUpNext(reordered);
        return;
      }

      const targetPlaylistId = parsePlaylistDropId(overId);
      if (targetPlaylistId && targetPlaylistId !== "none") {
        try {
          await playlistApi.addSongs({
            playlistId: targetPlaylistId,
            songIds: draggedSongIds,
          });
          await refreshPlaylistTracks(targetPlaylistId);
        } catch (error: unknown) {
          setErrorMessage(String(error));
        }
        return;
      }

      const overPlaylistNodeId = parsePlaylistNodeId(overId);
      if (overPlaylistNodeId) {
        const overPlaylist = playlists.find((playlist) => playlist.id === overPlaylistNodeId);
        if (overPlaylist && !overPlaylist.is_folder) {
          try {
            await playlistApi.addSongs({
              playlistId: overPlaylistNodeId,
              songIds: draggedSongIds,
            });
            await refreshPlaylistTracks(overPlaylistNodeId);
          } catch (error: unknown) {
            setErrorMessage(String(error));
          }
        }
        return;
      }

      const overTrackSongId = parsePlaylistTrackId(overId);
      if (
        overTrackSongId &&
        songPayload.source === "playlist" &&
        songPayload.fromPlaylistId &&
        songPayload.fromPlaylistId === activePlaylistId
      ) {
        const activeTrackSongId = parsePlaylistTrackId(activeId);
        if (!activeTrackSongId || !activePlaylistId) {
          return;
        }

        const currentOrder = activePlaylistTrackIds;
        const oldIndex = currentOrder.indexOf(activeTrackSongId);
        const newIndex = currentOrder.indexOf(overTrackSongId);
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
          return;
        }

        const reordered = arrayMove(currentOrder, oldIndex, newIndex);
        try {
          await playlistApi.reorderTracks(activePlaylistId, reordered);
          await refreshPlaylistTracks(activePlaylistId);
        } catch (error: unknown) {
          setErrorMessage(String(error));
        }
      }
    },
    [
      activePlaylistId,
      activePlaylistTrackIds,
      addSongsToQueue,
      playlists,
      refreshPlaylistTracks,
      refreshPlaylists,
      reorderUpNext,
      upNext,
    ],
  );

  const refreshAllViews = useCallback(async () => {
    resetSongPages();
    await refreshSongCount();
    await ensureSongPage(0);

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
  }, [
    activePlaylistId,
    ensureSongPage,
    refreshAlbums,
    refreshArtists,
    refreshPlaylists,
    refreshPlaylistTracks,
    refreshSongCount,
    refreshTags,
    resetSongPages,
  ]);

  const resetImportWizard = useCallback(() => {
    setShowImportWizard(false);
    setImportWizardStep(1);
    setItunesXmlPath("");
    setItunesPreview(null);
    setItunesProgress(null);
    setItunesSummary(null);
    setIsImporting(false);
    setItunesOptions({
      import_play_counts: true,
      import_ratings: true,
      import_comments: true,
      import_playlists: true,
    });
  }, []);

  const handlePickItunesXml = useCallback(async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select iTunes Library.xml",
      filters: [{ name: "iTunes XML", extensions: ["xml"] }],
    });

    if (typeof selected !== "string") {
      return;
    }

    setItunesXmlPath(selected);
    setImportWizardStep(2);
    setErrorMessage(null);

    try {
      const preview = await libraryApi.importItunesPreview(selected);
      setItunesPreview(preview);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, []);

  const handleRunItunesImport = useCallback(async () => {
    if (!itunesXmlPath) {
      return;
    }

    setImportWizardStep(4);
    setIsImporting(true);
    setErrorMessage(null);

    try {
      const summary = await libraryApi.importItunes(itunesXmlPath, itunesOptions);
      setItunesSummary(summary);
      setImportWizardStep(5);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    } finally {
      setIsImporting(false);
    }
  }, [itunesOptions, itunesXmlPath, refreshAllViews]);

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

  const handleSongSortClick = useCallback(
    (field: SongSortField) => {
      const order = nextSort(songSort, songOrder, field);
      setSongSort(field, order);
      resetSongPages();
      void refreshSongCount()
        .then(() => ensureSongPage(0))
        .catch((error: unknown) => setErrorMessage(String(error)));
    },
    [ensureSongPage, refreshSongCount, resetSongPages, setSongSort, songOrder, songSort],
  );

  const playFromSongsIndex = useCallback(
    async (index: number) => {
      const clickedSong = songsByIndex[index];
      if (!clickedSong) {
        return;
      }

      const allSongs = await loadAllSongsForCurrentSort();
      const startIndex = allSongs.findIndex((song) => song.id === clickedSong.id);
      if (startIndex < 0) {
        return;
      }

      setQueueSourceSongs(allSongs);
      setQueueSourceLabel("Library");
      await replaceQueueAndPlay(allSongs, startIndex);
    },
    [loadAllSongsForCurrentSort, replaceQueueAndPlay, songsByIndex],
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

      const songsById = new Map(songLookupById);
      const missingSongIds = orderedSongIds.filter((songId) => !songsById.has(songId));
      if (missingSongIds.length > 0) {
        const fetchedSongs = await libraryApi.getSongsByIds(missingSongIds);
        for (const song of fetchedSongs) {
          songsById.set(song.id, song);
        }
      }

      const songs = orderedSongIds
        .map((songId) => songsById.get(songId))
        .filter((song): song is SongListItem => Boolean(song));
      const startSongId = orderedSongIds[index];
      const startIndex = songs.findIndex((song) => song.id === startSongId);
      if (startIndex < 0) {
        return;
      }

      setQueueSourceSongs(songs);
      setQueueSourceLabel(activePlaylist.name);
      await replaceQueueAndPlay(songs, startIndex);
    },
    [activePlaylist, activePlaylistTrackIds, replaceQueueAndPlay, songLookupById],
  );

  const removeSelectedFromActivePlaylist = useCallback(async () => {
    if (!activePlaylistId || selectedSongIds.length === 0) {
      return;
    }
    try {
      await playlistApi.removeSongs(activePlaylistId, selectedSongIds);
      await refreshPlaylistTracks(activePlaylistId);
      clearSelection();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [activePlaylistId, clearSelection, refreshPlaylistTracks, selectedSongIds]);

  const currentSong = useMemo(
    () => nowPlaying ?? (currentIndex !== null ? (queue[currentIndex] ?? null) : null),
    [currentIndex, nowPlaying, queue],
  );
  const canReorderActivePlaylist = useMemo(() => {
    if (!activePlaylistId) {
      return false;
    }
    if (activePlaylistTrackCount === 0) {
      return true;
    }
    const loadedPages = loadedPagesByPlaylistId[activePlaylistId] ?? [];
    const expectedPages = Math.ceil(activePlaylistTrackCount / PLAYLIST_PAGE_SIZE);
    return loadedPages.length >= expectedPages;
  }, [activePlaylistId, activePlaylistTrackCount, loadedPagesByPlaylistId]);

  const togglePlaylistReorderMode = useCallback(() => {
    if (!activePlaylistId) {
      return;
    }
    if (playlistReorderMode) {
      setPlaylistReorderMode(false);
      return;
    }

    setPlaylistReorderMode(true);
    const totalPages = Math.ceil(activePlaylistTrackCount / PLAYLIST_PAGE_SIZE);
    for (let page = 0; page < totalPages; page += 1) {
      void ensurePlaylistPage(activePlaylistId, page);
    }
  }, [activePlaylistId, activePlaylistTrackCount, ensurePlaylistPage, playlistReorderMode]);

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
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedSearchQuery) {
      setSearchResults(null);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    void libraryApi
      .search(debouncedSearchQuery, SEARCH_RESULT_LIMIT, selectedTagFilterIds)
      .then((result) => {
        if (!cancelled) {
          setSearchResults(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery, selectedTagFilterIds]);

  useEffect(() => {
    void audioApi.setVolume(persistedVolume).catch(() => {
      // Ignore initial volume sync errors.
    });
  }, [persistedVolume]);

  useEffect(() => {
    resetSongPages();
    void refreshSongCount()
      .then(() => ensureSongPage(0))
      .catch((error: unknown) => setErrorMessage(String(error)));
  }, [ensureSongPage, refreshSongCount, resetSongPages]);

  useEffect(() => {
    if (activeView === "albums") {
      void refreshAlbums().catch((error: unknown) => setErrorMessage(String(error)));
    }
  }, [activeView, refreshAlbums]);

  useEffect(() => {
    if (activeView === "artists") {
      void refreshArtists().catch((error: unknown) => setErrorMessage(String(error)));
    }
  }, [activeView, refreshArtists]);

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
  }, [activeView, tracePerf]);

  useEffect(() => {
    void refreshPlaylists().catch((error: unknown) => setErrorMessage(String(error)));
  }, [refreshPlaylists]);

  useEffect(() => {
    void refreshTags().catch((error: unknown) => setErrorMessage(String(error)));
  }, [refreshTags]);

  useEffect(() => {
    if (activeView !== "playlist" || !activePlaylistId) {
      return;
    }
    const requestId = activePlaylistRequestIdRef.current + 1;
    activePlaylistRequestIdRef.current = requestId;
    void refreshPlaylistTracks(activePlaylistId, requestId).catch((error: unknown) =>
      setErrorMessage(String(error)),
    );
  }, [activePlaylistId, activeView, refreshPlaylistTracks]);

  useEffect(() => {
    if (queueSongIds.length === 0) {
      setQueue([], null);
      setCurrentIndex(null);
      setNowPlaying(null);
      return;
    }

    void libraryApi
      .getSongsByIds(queueSongIds)
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
    queueCurrentIndex,
    queueSongIds,
    queueSourceLabel,
    setCurrentIndex,
    setNowPlaying,
    setPlayingFrom,
    setQueue,
  ]);

  useEffect(() => {
    const virtualRows = songVirtualizer.getVirtualItems();

    if (activeView !== "songs" || songCount === 0) {
      return;
    }

    if (virtualRows.length === 0) {
      void ensureSongPage(0);
      return;
    }

    const first = virtualRows[0].index;
    const last = virtualRows[virtualRows.length - 1].index;
    const firstPage = Math.floor(first / SONG_PAGE_SIZE);
    const lastPage = Math.floor(last / SONG_PAGE_SIZE);

    for (let page = firstPage - 1; page <= lastPage + 1; page += 1) {
      if (page >= 0) {
        void ensureSongPage(page);
      }
    }
  }, [activeView, ensureSongPage, songCount, songVirtualizer]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth && Number.isFinite(nextWidth)) {
        setAlbumGridWidth(nextWidth);
      }
    });

    const element = albumsScrollRef.current;
    if (element) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

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
    setPlaybackState,
    setPosition,
    tracePerf,
    triggerStatsRefresh,
  ]);

  useEffect(() => {
    if (activeView === "stats") {
      triggerStatsRefresh();
    }
  }, [activeView, triggerStatsRefresh]);

  // Sync Now Playing to OS media controls
  const playbackStateForMediaSync = usePlayerStore((s) => s.playbackState);
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
    const unlisteners: Array<Promise<UnlistenFn>> = [
      listen("menu:scan-music-folder", () => {
        void handlePickFolderAndScan();
      }),
      listen("menu:import-itunes-library", () => {
        setShowImportWizard(true);
        setImportWizardStep(1);
        setErrorMessage(null);
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => {
        for (const callback of callbacks) {
          callback();
        }
      });
    };
  }, [handlePickFolderAndScan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        if (selectedSongIds.length === 0) {
          return;
        }
        event.preventDefault();
        copySelectionToClipboard();
        setClipboardHint(`${selectedSongIds.length} song(s) copied`);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        if (clipboardSongIds.length === 0) {
          return;
        }
        event.preventDefault();

        if (activeView !== "playlist" || !activePlaylistId) {
          setClipboardHint("Paste only works while viewing a playlist");
          return;
        }

        void playlistApi
          .addSongs({ playlistId: activePlaylistId, songIds: clipboardSongIds })
          .then(() => refreshPlaylistTracks(activePlaylistId))
          .then(() => setClipboardHint(`${clipboardSongIds.length} song(s) pasted`))
          .catch((error: unknown) => setErrorMessage(String(error)));
      }

      if (event.key === "Escape") {
        closeUpNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activePlaylistId,
    activeView,
    clipboardSongIds,
    closeUpNext,
    copySelectionToClipboard,
    refreshPlaylistTracks,
    selectedSongIds.length,
  ]);

  useEffect(() => {
    if (!clipboardHint) {
      return;
    }
    const timer = window.setTimeout(() => setClipboardHint(null), 2200);
    return () => window.clearTimeout(timer);
  }, [clipboardHint]);

  useEffect(() => {
    if (!songContextMenu) {
      return;
    }

    const close = () => setSongContextMenu(null);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("click", close);
    };
  }, [songContextMenu]);

  useEffect(() => {
    if (!showTagFilterMenu) {
      return;
    }
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (tagFilterMenuRootRef.current?.contains(target)) {
        return;
      }
      setShowTagFilterMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mousedown", close);
    };
  }, [showTagFilterMenu]);

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

  const songVirtualRows = songVirtualizer.getVirtualItems();
  const albumVirtualRows = albumsVirtualizer.getVirtualItems();
  const artistVirtualRows = artistsVirtualizer.getVirtualItems();

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
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Group orientation="horizontal" className="h-full w-full">
              <Panel
                id="sidebar"
                defaultSize={`${sidebarSize}%`}
                minSize="16%"
                maxSize="35%"
                onResize={(size) => setSidebarSize(Math.round(size.asPercentage))}
              >
                <aside className="h-full overflow-y-auto border-r border-border/80 bg-surface/85 p-4 backdrop-blur-sm">
                  <div className="mb-6 flex items-center gap-2">
                    <div className="rounded-full bg-sky p-2 text-night">
                      <Waves className="h-4 w-4" />
                    </div>
                    <div>
                      <h1 className="text-lg font-semibold tracking-tight">borf</h1>
                      <p className="text-xs text-muted">Phase 4 metadata + tags + auto-sync</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2 rounded-xl border border-border bg-white/80 p-3 text-sm">
                    <p className="font-medium">Library</p>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "songs"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        perfViewSwitchRef.current = { view: "songs", startedAt: performance.now() };
                        setPlaylistReorderMode(false);
                        setActiveView("songs");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedAlbum(null);
                        setSelectedArtist(null);
                      }}
                    >
                      <Library className="h-4 w-4" />
                      Songs
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "albums"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        perfViewSwitchRef.current = {
                          view: "albums",
                          startedAt: performance.now(),
                        };
                        setPlaylistReorderMode(false);
                        setActiveView("albums");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedArtist(null);
                      }}
                    >
                      <Disc3 className="h-4 w-4" />
                      Albums
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "artists"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        perfViewSwitchRef.current = {
                          view: "artists",
                          startedAt: performance.now(),
                        };
                        setPlaylistReorderMode(false);
                        setActiveView("artists");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedAlbum(null);
                      }}
                    >
                      <UserRound className="h-4 w-4" />
                      Artists
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "settings"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        perfViewSwitchRef.current = {
                          view: "settings",
                          startedAt: performance.now(),
                        };
                        setPlaylistReorderMode(false);
                        setActiveView("settings");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedAlbum(null);
                        setSelectedArtist(null);
                      }}
                    >
                      <Settings2 className="h-4 w-4" />
                      Settings
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "history"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        setPlaylistReorderMode(false);
                        setActiveView("history");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedAlbum(null);
                        setSelectedArtist(null);
                      }}
                    >
                      <Clock3 className="h-4 w-4" />
                      History
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                        activeView === "stats"
                          ? "bg-sky/30 text-text"
                          : "text-muted hover:bg-sky/10",
                      )}
                      onClick={() => {
                        setPlaylistReorderMode(false);
                        setActiveView("stats");
                        setActivePlaylistId(null);
                        clearSelection();
                        setSelectedAlbum(null);
                        setSelectedArtist(null);
                      }}
                    >
                      <BarChart2 className="h-4 w-4" />
                      Stats
                    </button>
                  </div>

                  <PlaylistSidebar
                    playlists={playlists}
                    activePlaylistId={activePlaylistId}
                    onSelectPlaylist={(playlistId) => {
                      void openPlaylist(playlistId);
                    }}
                    onCreatePlaylist={(parentId) => {
                      void handleCreatePlaylist(parentId, false);
                    }}
                    onCreateFolder={(parentId) => {
                      void handleCreatePlaylist(parentId, true);
                    }}
                    onRenamePlaylist={(playlist) => {
                      void handleRenamePlaylist(playlist);
                    }}
                    onDeletePlaylist={(playlist) => {
                      void handleDeletePlaylist(playlist);
                    }}
                    onDuplicatePlaylist={(playlist) => {
                      void handleDuplicatePlaylist(playlist);
                    }}
                    onExportM3u8={(playlist) => {
                      void handleExportPlaylistM3u8(playlist);
                    }}
                  />

                  <div className="mt-4 rounded-xl border border-border bg-white/80 p-3 text-xs text-muted">
                    <p className="font-medium text-text">Status</p>
                    {isScanning ? (
                      <p className="mt-1 text-accent">Scanning in progress...</p>
                    ) : null}
                    <p className="mt-1 break-words">{statusMessage}</p>
                    {scanProgress ? (
                      <div className="mt-2 space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-sky/30">
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-200"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <p>
                          {scanProgress.scanned.toLocaleString()} /{" "}
                          {scanProgress.total.toLocaleString()}
                        </p>
                        <p className="truncate" title={scanProgress.current_file}>
                          {scanProgress.current_file}
                        </p>
                      </div>
                    ) : null}
                    {errorMessage ? <p className="mt-2 text-red-600">{errorMessage}</p> : null}
                  </div>
                </aside>
              </Panel>

              <Separator className="w-1 bg-transparent transition-colors hover:bg-sky/60" />

              <Panel id="main" minSize="40%">
                <main className="flex h-full min-h-0 flex-col bg-white/70 backdrop-blur-sm">
                  <header className="relative border-b border-border px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight">
                          {activeView === "songs"
                            ? "Songs"
                            : activeView === "albums"
                              ? "Albums"
                              : activeView === "artists"
                                ? "Artists"
                                : activeView === "history"
                                  ? "History"
                                  : activeView === "stats"
                                    ? "Stats"
                                    : activeView === "settings"
                                      ? "Settings"
                                      : (activePlaylist?.name ?? "Playlist")}
                        </h2>
                        <p className="text-sm text-muted">
                          {activeView === "songs"
                            ? `${songCount.toLocaleString()} songs`
                            : activeView === "albums"
                              ? `${albums.length.toLocaleString()} albums`
                              : activeView === "artists"
                                ? `${artists.length.toLocaleString()} artists`
                                : activeView === "history"
                                  ? "Recent plays"
                                  : activeView === "stats"
                                    ? "Listening statistics"
                                    : activeView === "settings"
                                      ? `${tags.length.toLocaleString()} tags`
                                      : `${activePlaylistTrackCount.toLocaleString()} songs`}
                        </p>
                      </div>

                      <div className="relative w-full max-w-xl" ref={tagFilterMenuRootRef}>
                        <div className="flex gap-2">
                          <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                            <Input
                              ref={searchInputRef}
                              value={searchQuery}
                              onChange={(event) => setSearchQuery(event.target.value)}
                              placeholder="Search songs/albums/artists or tag:chill (Cmd+K)"
                              className="pl-10"
                            />
                          </div>
                          <Button
                            type="button"
                            variant={selectedTagFilterIds.length > 0 ? "default" : "secondary"}
                            size="sm"
                            className="shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              setShowTagFilterMenu((previous) => !previous);
                            }}
                          >
                            <TagsIcon className="mr-1 h-3.5 w-3.5" />
                            Tags
                            {selectedTagFilterIds.length > 0
                              ? ` (${selectedTagFilterIds.length})`
                              : ""}
                          </Button>
                        </div>
                        {showTagFilterMenu ? (
                          <div className="absolute right-0 top-[110%] z-40 w-64 rounded-xl border border-border bg-white p-3 shadow-lg">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                              Filter Songs By Tags
                            </p>
                            <div className="max-h-52 space-y-1 overflow-auto">
                              {tags.length === 0 ? (
                                <p className="text-xs text-muted">No tags available.</p>
                              ) : (
                                tags.map((tag) => (
                                  <label key={tag.id} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={selectedTagFilterIds.includes(tag.id)}
                                      onChange={(event) => {
                                        if (event.target.checked) {
                                          setSelectedTagFilterIds((previous) => [
                                            ...new Set([...previous, tag.id]),
                                          ]);
                                        } else {
                                          setSelectedTagFilterIds((previous) =>
                                            previous.filter((value) => value !== tag.id),
                                          );
                                        }
                                      }}
                                    />
                                    <span
                                      className="h-3.5 w-3.5 rounded-full border border-border/70"
                                      style={{ backgroundColor: tag.color }}
                                    />
                                    <span className="truncate">{tag.name}</span>
                                  </label>
                                ))
                              )}
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSelectedTagFilterIds([])}
                              >
                                Clear
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setShowTagFilterMenu(false)}
                              >
                                Done
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {debouncedSearchQuery ? (
                      <div className="absolute left-6 right-6 top-[100%] z-30 mt-2 max-h-[420px] overflow-auto rounded-xl border border-border bg-white p-3 shadow-lg">
                        {isSearching ? (
                          <div className="flex items-center gap-2 text-sm text-muted">
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Searching...
                          </div>
                        ) : null}

                        {!isSearching && searchResults ? (
                          <div className="space-y-4">
                            <section>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                Songs
                              </p>
                              <div className="space-y-1">
                                {searchResults.songs.map((song, index) => (
                                  <DraggableSongButton
                                    key={song.id}
                                    draggableId={`search-song:${song.id}`}
                                    payload={{
                                      type: "song",
                                      songIds: [song.id],
                                      source: "search",
                                    }}
                                    className="group/song flex w-full select-none items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-sky/10"
                                    onClick={() => {
                                      setQueueSourceSongs(searchResults.songs);
                                      setQueueSourceLabel("Search Results");
                                      void replaceQueueAndPlay(searchResults.songs, index).catch(
                                        (error: unknown) => setErrorMessage(String(error)),
                                      );
                                      setSearchQuery("");
                                    }}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <SongArtwork
                                        artworkPath={song.artwork_path}
                                        sizeClassName="h-8 w-8"
                                        playLabel={`Play ${song.title}`}
                                        onPlay={() => {
                                          setQueueSourceSongs(searchResults.songs);
                                          setQueueSourceLabel("Search Results");
                                          void replaceQueueAndPlay(
                                            searchResults.songs,
                                            index,
                                          ).catch((error: unknown) =>
                                            setErrorMessage(String(error)),
                                          );
                                          setSearchQuery("");
                                        }}
                                      />
                                      <span className="truncate">
                                        {song.title}{" "}
                                        <span className="text-muted">• {song.artist}</span>
                                      </span>
                                    </span>
                                    <span className="flex items-center gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          addSongsToQueue([song.id]);
                                        }}
                                      >
                                        Queue
                                      </Button>
                                      <span className="text-xs text-muted">
                                        {formatDuration(song.duration_ms)}
                                      </span>
                                    </span>
                                  </DraggableSongButton>
                                ))}
                                {searchResults.songs.length === 0 ? (
                                  <p className="text-xs text-muted">No song matches.</p>
                                ) : null}
                              </div>
                            </section>

                            <section>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                Albums
                              </p>
                              <div className="space-y-1">
                                {searchResults.albums.map((album) => (
                                  <button
                                    key={`${album.album}-${album.album_artist}`}
                                    type="button"
                                    className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-sky/10"
                                    onClick={() => {
                                      perfViewSwitchRef.current = {
                                        view: "albums",
                                        startedAt: performance.now(),
                                      };
                                      setPlaylistReorderMode(false);
                                      setActiveView("albums");
                                      setActivePlaylistId(null);
                                      void openAlbum(album).catch((error: unknown) =>
                                        setErrorMessage(String(error)),
                                      );
                                      setSearchQuery("");
                                    }}
                                  >
                                    <span className="truncate">
                                      {album.album}{" "}
                                      <span className="text-muted">• {album.album_artist}</span>
                                    </span>
                                  </button>
                                ))}
                                {searchResults.albums.length === 0 ? (
                                  <p className="text-xs text-muted">No album matches.</p>
                                ) : null}
                              </div>
                            </section>

                            <section>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                                Artists
                              </p>
                              <div className="space-y-1">
                                {searchResults.artists.map((artist) => (
                                  <button
                                    key={artist.artist}
                                    type="button"
                                    className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-sky/10"
                                    onClick={() => {
                                      perfViewSwitchRef.current = {
                                        view: "artists",
                                        startedAt: performance.now(),
                                      };
                                      setPlaylistReorderMode(false);
                                      setActiveView("artists");
                                      setActivePlaylistId(null);
                                      void openArtist(artist.artist).catch((error: unknown) =>
                                        setErrorMessage(String(error)),
                                      );
                                      setSearchQuery("");
                                    }}
                                  >
                                    <span className="truncate">{artist.artist}</span>
                                  </button>
                                ))}
                                {searchResults.artists.length === 0 ? (
                                  <p className="text-xs text-muted">No artist matches.</p>
                                ) : null}
                              </div>
                            </section>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </header>

                  <section className="min-h-0 flex-1 px-4 pb-4 pt-2">
                    {activeView === "songs" ? (
                      <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-white">
                        <div className="grid grid-cols-[48px_2fr_1.6fr_1.6fr_120px_90px] gap-3 border-b border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          <span>#</span>
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => handleSongSortClick("title")}
                          >
                            Title {songSort === "title" ? (songOrder === "asc" ? "↑" : "↓") : ""}
                          </button>
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => handleSongSortClick("artist")}
                          >
                            Artist {songSort === "artist" ? (songOrder === "asc" ? "↑" : "↓") : ""}
                          </button>
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => handleSongSortClick("album")}
                          >
                            Album {songSort === "album" ? (songOrder === "asc" ? "↑" : "↓") : ""}
                          </button>
                          <button
                            type="button"
                            className="text-right"
                            onClick={() => handleSongSortClick("duration_ms")}
                          >
                            Duration{" "}
                            {songSort === "duration_ms" ? (songOrder === "asc" ? "↑" : "↓") : ""}
                          </button>
                          <button
                            type="button"
                            className="text-right"
                            onClick={() => handleSongSortClick("play_count")}
                          >
                            Plays{" "}
                            {songSort === "play_count" ? (songOrder === "asc" ? "↑" : "↓") : ""}
                          </button>
                        </div>

                        <div ref={songsScrollRef} className="min-h-0 flex-1 overflow-auto">
                          <div
                            style={{
                              height: `${songVirtualizer.getTotalSize()}px`,
                              position: "relative",
                            }}
                          >
                            {songVirtualRows.map((virtualRow) => {
                              const song = songsByIndex[virtualRow.index];
                              const isSelected = song ? selectedSongIdSet.has(song.id) : false;
                              const isActive = currentSong?.id === song?.id;

                              return (
                                <div
                                  key={virtualRow.key}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    width: "100%",
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                >
                                  <DraggableSongButton
                                    draggableId={
                                      song
                                        ? `library-song:${song.id}`
                                        : `library-loading:${virtualRow.index}`
                                    }
                                    payload={{
                                      type: "song",
                                      songIds:
                                        song && selectedSongIdSet.has(song.id)
                                          ? selectedSongIds
                                          : song
                                            ? [song.id]
                                            : [],
                                      source: "library",
                                    }}
                                    onClick={(event) => {
                                      if (!song) {
                                        return;
                                      }

                                      const orderedSongIds = songsOrderedIds.filter(
                                        (songId): songId is string => Boolean(songId),
                                      );
                                      const songIndex = orderedSongIds.indexOf(song.id);
                                      selectSongs({
                                        songId: song.id,
                                        songIndex: songIndex < 0 ? 0 : songIndex,
                                        orderedSongIds,
                                        mode: event.shiftKey
                                          ? "range"
                                          : event.metaKey
                                            ? "toggle"
                                            : "single",
                                      });
                                    }}
                                    onDoubleClick={() => {
                                      if (!song) {
                                        return;
                                      }
                                      void playFromSongsIndex(virtualRow.index).catch(
                                        (error: unknown) => setErrorMessage(String(error)),
                                      );
                                    }}
                                    onContextMenu={(event) => {
                                      if (!song) {
                                        return;
                                      }
                                      event.preventDefault();
                                      if (!selectedSongIdSet.has(song.id)) {
                                        selectSongs({
                                          songId: song.id,
                                          songIndex: 0,
                                          orderedSongIds: [song.id],
                                          mode: "single",
                                        });
                                      }
                                      const songIds = selectedSongIdSet.has(song.id)
                                        ? selectedSongIds
                                        : [song.id];
                                      setSongContextMenu({
                                        x: event.clientX,
                                        y: event.clientY,
                                        songIds,
                                        index: virtualRow.index,
                                        source: "library",
                                      });
                                    }}
                                    className={cn(
                                      "group/song grid h-full w-full select-none grid-cols-[48px_2fr_1.6fr_1.6fr_120px_90px] items-center gap-3 border-b border-border/60 px-3 text-left text-sm transition-colors",
                                      "hover:bg-sky/15",
                                      isSelected && "bg-sky/20",
                                      isActive && "bg-blossom/25",
                                    )}
                                  >
                                    {song ? (
                                      <>
                                        <span className="text-muted">{virtualRow.index + 1}</span>
                                        <div className="flex min-w-0 items-center gap-2">
                                          <SongArtwork
                                            artworkPath={song.artwork_path}
                                            playLabel={`Play ${song.title}`}
                                            onPlay={() => {
                                              void playFromSongsIndex(virtualRow.index).catch(
                                                (error: unknown) => setErrorMessage(String(error)),
                                              );
                                            }}
                                          />
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                              <span className="truncate font-medium">
                                                {song.title}
                                              </span>
                                              {song.custom_start_ms > 0 ? (
                                                <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted" />
                                              ) : null}
                                            </div>
                                            {song.tags.length > 0 ? (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {song.tags.slice(0, 3).map((tag) => (
                                                  <span
                                                    key={tag.id}
                                                    className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] leading-none"
                                                    style={{ backgroundColor: `${tag.color}40` }}
                                                  >
                                                    {tag.name}
                                                  </span>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        <span className="truncate text-muted">{song.artist}</span>
                                        <span className="truncate text-muted">{song.album}</span>
                                        <span className="text-right text-muted">
                                          {formatDuration(song.duration_ms)}
                                        </span>
                                        <span className="text-right text-muted">
                                          {song.play_count}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-muted">{virtualRow.index + 1}</span>
                                        <span className="col-span-5 text-muted">Loading...</span>
                                      </>
                                    )}
                                  </DraggableSongButton>
                                </div>
                              );
                            })}

                            {songCount === 0 ? (
                              <p className="p-6 text-sm text-muted">No songs to display yet.</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {activeView === "playlist" ? (
                      <PlaylistView
                        playlist={activePlaylist}
                        tracks={activePlaylistTracksByIndex}
                        trackCount={activePlaylistTrackCount}
                        currentSongId={currentSong?.id ?? null}
                        selectedSongIds={selectedSongIds}
                        selectedSongIdSet={selectedSongIdSet}
                        isReorderMode={playlistReorderMode}
                        canReorder={canReorderActivePlaylist}
                        onToggleReorderMode={togglePlaylistReorderMode}
                        onRequestTrackRange={(startIndex, endIndex) => {
                          if (activePlaylistId) {
                            requestPlaylistTrackRange(activePlaylistId, startIndex, endIndex);
                          }
                        }}
                        onSelectTrack={handlePlaylistTrackSelection}
                        onPlayTrack={(index) => {
                          void playFromPlaylistIndex(index).catch((error: unknown) =>
                            setErrorMessage(String(error)),
                          );
                        }}
                        onAddToQueue={(songId) => addSongsToQueue([songId])}
                        onRemoveSelected={() => {
                          void removeSelectedFromActivePlaylist();
                        }}
                        onTrackContextMenu={(event, songId, index) => {
                          event.preventDefault();
                          if (!selectedSongIdSet.has(songId)) {
                            handlePlaylistTrackSelection(songId, index, {
                              shiftKey: false,
                              metaKey: false,
                            });
                          }
                          setSongContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            songIds: selectedSongIdSet.has(songId) ? selectedSongIds : [songId],
                            index,
                            source: "playlist",
                          });
                        }}
                      />
                    ) : null}

                    {activeView === "albums" ? (
                      <div className="h-full rounded-xl border border-border bg-white p-4">
                        {selectedAlbum ? (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="mb-4 flex items-center justify-between">
                              <div>
                                <h3 className="text-lg font-semibold">{selectedAlbum.album}</h3>
                                <p className="text-sm text-muted">{selectedAlbum.album_artist}</p>
                              </div>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedAlbum(null);
                                  setAlbumTracks([]);
                                }}
                              >
                                Back to albums
                              </Button>
                            </div>

                            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
                              {loadingAlbumTracks ? (
                                <p className="p-4 text-sm text-muted">Loading album tracks...</p>
                              ) : (
                                albumTracks.map((song, index) => (
                                  <button
                                    key={song.id}
                                    type="button"
                                    className={cn(
                                      "group/song grid w-full select-none grid-cols-[48px_2fr_1.6fr_120px] gap-3 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-sky/15",
                                      currentSong?.id === song.id && "bg-blossom/25",
                                    )}
                                    onDoubleClick={() => {
                                      setQueueSourceSongs(albumTracks);
                                      setQueueSourceLabel(selectedAlbum?.album ?? "Album");
                                      void replaceQueueAndPlay(albumTracks, index).catch(
                                        (error: unknown) => setErrorMessage(String(error)),
                                      );
                                    }}
                                  >
                                    <span className="text-muted">{index + 1}</span>
                                    <div className="flex min-w-0 items-center gap-2">
                                      <SongArtwork
                                        artworkPath={song.artwork_path}
                                        playLabel={`Play ${song.title}`}
                                        onPlay={() => {
                                          setQueueSourceSongs(albumTracks);
                                          setQueueSourceLabel(selectedAlbum?.album ?? "Album");
                                          void replaceQueueAndPlay(albumTracks, index).catch(
                                            (error: unknown) => setErrorMessage(String(error)),
                                          );
                                        }}
                                      />
                                      <span className="truncate font-medium">{song.title}</span>
                                    </div>
                                    <span className="truncate text-muted">{song.artist}</span>
                                    <span className="text-right text-muted">
                                      {formatDuration(song.duration_ms)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        ) : (
                          <div ref={albumsScrollRef} className="h-full overflow-auto">
                            {isLoadingAlbums ? (
                              <p className="text-sm text-muted">Loading albums...</p>
                            ) : (
                              <div
                                style={{
                                  height: `${albumsVirtualizer.getTotalSize()}px`,
                                  position: "relative",
                                }}
                              >
                                {albumVirtualRows.map((virtualRow) => {
                                  const start = virtualRow.index * albumColumns;
                                  const rowAlbums = albums.slice(start, start + albumColumns);

                                  return (
                                    <div
                                      key={virtualRow.key}
                                      style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        transform: `translateY(${virtualRow.start}px)`,
                                      }}
                                      className="grid gap-4"
                                    >
                                      <div
                                        className="grid gap-4"
                                        style={{
                                          gridTemplateColumns: `repeat(${albumColumns}, minmax(0, 1fr))`,
                                        }}
                                      >
                                        {rowAlbums.map((album) => (
                                          <button
                                            key={`${album.album}-${album.album_artist}`}
                                            type="button"
                                            className="rounded-xl border border-border bg-surface/80 p-4 text-left transition-colors hover:bg-sky/20"
                                            onClick={() => {
                                              void openAlbum(album).catch((error: unknown) =>
                                                setErrorMessage(String(error)),
                                              );
                                            }}
                                          >
                                            <div className="mb-3 flex h-32 items-center justify-center rounded-lg bg-sky/25">
                                              <Disc3 className="h-8 w-8 text-night/70" />
                                            </div>
                                            <p className="truncate font-medium">{album.album}</p>
                                            <p className="truncate text-sm text-muted">
                                              {album.album_artist}
                                            </p>
                                            <p className="mt-1 text-xs text-muted">
                                              {album.song_count} songs •{" "}
                                              {formatDuration(album.total_duration_ms)}
                                            </p>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {activeView === "artists" ? (
                      <div className="h-full rounded-xl border border-border bg-white p-4">
                        {!selectedArtist ? (
                          <div
                            ref={artistsScrollRef}
                            className="h-full overflow-auto rounded-lg border border-border"
                          >
                            {isLoadingArtists ? (
                              <p className="p-4 text-sm text-muted">Loading artists...</p>
                            ) : (
                              <div
                                style={{
                                  height: `${artistsVirtualizer.getTotalSize()}px`,
                                  position: "relative",
                                }}
                              >
                                {artistVirtualRows.map((virtualRow) => {
                                  const artist = artists[virtualRow.index];
                                  if (!artist) {
                                    return null;
                                  }

                                  return (
                                    <div
                                      key={virtualRow.key}
                                      style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="grid h-full w-full grid-cols-[2fr_120px_120px] gap-3 border-b border-border/60 px-3 text-left text-sm hover:bg-sky/15"
                                        onClick={() => {
                                          void openArtist(artist.artist).catch((error: unknown) =>
                                            setErrorMessage(String(error)),
                                          );
                                        }}
                                      >
                                        <span className="truncate font-medium">
                                          {artist.artist}
                                        </span>
                                        <span className="text-right text-muted">
                                          {artist.album_count} albums
                                        </span>
                                        <span className="text-right text-muted">
                                          {artist.song_count} songs
                                        </span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="mb-4 flex items-center justify-between">
                              <div>
                                <h3 className="text-lg font-semibold">{selectedArtist}</h3>
                                <p className="text-sm text-muted">Artist view</p>
                              </div>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedArtist(null);
                                  setSelectedArtistAlbum(null);
                                  setArtistAlbums([]);
                                  setArtistAlbumTracks([]);
                                }}
                              >
                                Back to artists
                              </Button>
                            </div>

                            {!selectedArtistAlbum ? (
                              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border p-3">
                                {loadingArtistAlbums ? (
                                  <p className="text-sm text-muted">Loading albums...</p>
                                ) : (
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                                    {artistAlbums.map((album) => (
                                      <button
                                        key={`${album.album}-${album.album_artist}`}
                                        type="button"
                                        className="rounded-xl border border-border bg-surface/80 p-4 text-left hover:bg-sky/20"
                                        onClick={() => {
                                          void openArtistAlbum(album).catch((error: unknown) =>
                                            setErrorMessage(String(error)),
                                          );
                                        }}
                                      >
                                        <p className="truncate font-medium">{album.album}</p>
                                        <p className="text-sm text-muted">
                                          {album.song_count} songs
                                        </p>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
                                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                                  <div>
                                    <p className="font-medium">{selectedArtistAlbum.album}</p>
                                    <p className="text-xs text-muted">
                                      {selectedArtistAlbum.album_artist}
                                    </p>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    onClick={() => {
                                      setSelectedArtistAlbum(null);
                                      setArtistAlbumTracks([]);
                                    }}
                                  >
                                    Back to artist albums
                                  </Button>
                                </div>

                                {loadingArtistAlbumTracks ? (
                                  <p className="p-4 text-sm text-muted">Loading tracks...</p>
                                ) : (
                                  artistAlbumTracks.map((song, index) => (
                                    <button
                                      key={song.id}
                                      type="button"
                                      className={cn(
                                        "group/song grid w-full select-none grid-cols-[48px_2fr_120px] gap-3 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-sky/15",
                                        currentSong?.id === song.id && "bg-blossom/25",
                                      )}
                                      onDoubleClick={() => {
                                        setQueueSourceSongs(artistAlbumTracks);
                                        setQueueSourceLabel(selectedArtistAlbum?.album ?? "Artist");
                                        void replaceQueueAndPlay(artistAlbumTracks, index).catch(
                                          (error: unknown) => setErrorMessage(String(error)),
                                        );
                                      }}
                                    >
                                      <span className="text-muted">{index + 1}</span>
                                      <div className="flex min-w-0 items-center gap-2">
                                        <SongArtwork
                                          artworkPath={song.artwork_path}
                                          playLabel={`Play ${song.title}`}
                                          onPlay={() => {
                                            setQueueSourceSongs(artistAlbumTracks);
                                            setQueueSourceLabel(
                                              selectedArtistAlbum?.album ?? "Artist",
                                            );
                                            void replaceQueueAndPlay(
                                              artistAlbumTracks,
                                              index,
                                            ).catch((error: unknown) =>
                                              setErrorMessage(String(error)),
                                            );
                                          }}
                                        />
                                        <span className="truncate font-medium">{song.title}</span>
                                      </div>
                                      <span className="text-right text-muted">
                                        {formatDuration(song.duration_ms)}
                                      </span>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {activeView === "history" ? (
                      <div className="h-full rounded-xl border border-border bg-white">
                        <HistoryView
                          onPlaySong={(songId) => {
                            const cached = songLookupById.get(songId);
                            if (cached) {
                              void playSong(cached).catch((error: unknown) =>
                                setErrorMessage(String(error)),
                              );
                            } else {
                              void libraryApi
                                .getSongsByIds([songId])
                                .then((songs) => {
                                  if (songs[0]) {
                                    void playSong(songs[0]).catch((error: unknown) =>
                                      setErrorMessage(String(error)),
                                    );
                                  }
                                })
                                .catch((error: unknown) => setErrorMessage(String(error)));
                            }
                          }}
                        />
                      </div>
                    ) : null}

                    {activeView === "stats" ? (
                      <div className="h-full rounded-xl border border-border bg-white p-4">
                        <div className="h-full overflow-auto">
                          <StatsView refreshSignal={statsRefreshSignal} />
                        </div>
                      </div>
                    ) : null}

                    {activeView === "settings" ? (
                      <div className="h-full rounded-xl border border-border bg-white p-4">
                        <div className="h-full overflow-auto">
                          <TagsSettingsPanel
                            tags={tags}
                            onCreateTag={handleCreateTag}
                            onRenameTag={handleRenameTag}
                            onSetTagColor={handleSetTagColor}
                            onDeleteTag={handleDeleteTag}
                          />

                          <div className="mt-8">
                            <h3 className="mb-3 text-sm font-semibold">Export</h3>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-sky/10"
                                onClick={() => void handleExportPlayStatsCsv()}
                              >
                                <Download className="h-4 w-4" />
                                Play Stats CSV
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-sky/10"
                                onClick={() => void handleExportTagsCsv()}
                              >
                                <Download className="h-4 w-4" />
                                Tags CSV
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-sky/10"
                                onClick={() => void handleExportHierarchyMd()}
                              >
                                <Download className="h-4 w-4" />
                                Library Hierarchy (Markdown)
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </section>
                </main>
              </Panel>
            </Group>
          </div>

          <TransportBar
            currentSong={currentSong}
            queueLength={queue.length}
            songCount={songCount}
            upNextCount={upNext.length}
            shuffleEnabled={shuffleEnabled}
            repeatMode={repeatMode}
            clipboardHint={clipboardHint}
            clipboardCount={clipboardSongIds.length}
            volume={persistedVolume}
            onPrevious={playPrevious}
            onTogglePlayback={() => {
              void handleTogglePlayback().catch((error: unknown) => setErrorMessage(String(error)));
            }}
            onNext={playNext}
            onToggleShuffle={handleToggleShuffle}
            onCycleRepeat={() => setRepeatMode(cycleRepeatMode(repeatMode))}
            onSeek={(nextPosition, nextDurationMs) => {
              setPosition(nextPosition, nextDurationMs);
              void audioApi
                .seek(nextPosition)
                .catch((error: unknown) => setErrorMessage(String(error)));
            }}
            onOpenUpNext={openUpNext}
            onClearClipboard={clearClipboard}
            onVolumeChange={(nextVolume) => {
              setPersistedVolume(nextVolume);
              void audioApi
                .setVolume(nextVolume)
                .catch((error: unknown) => setErrorMessage(String(error)));
            }}
          />

          {songContextMenu ? (
            <div
              className="fixed z-50 rounded-lg border border-border bg-white p-1 shadow-lg"
              style={{ left: songContextMenu.x, top: songContextMenu.y }}
            >
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  if (songContextMenu.source === "playlist") {
                    void playFromPlaylistIndex(songContextMenu.index).catch((error: unknown) =>
                      setErrorMessage(String(error)),
                    );
                  } else {
                    void playFromSongsIndex(songContextMenu.index).catch((error: unknown) =>
                      setErrorMessage(String(error)),
                    );
                  }
                  setSongContextMenu(null);
                }}
              >
                Play from here
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  addSongsToQueue(songContextMenu.songIds);
                  setSongContextMenu(null);
                }}
              >
                Add to Queue
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  setClipboardSongIds(songContextMenu.songIds);
                  setClipboardHint(`${songContextMenu.songIds.length} song(s) copied`);
                  setSongContextMenu(null);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  void openManageTagsForSongs(songContextMenu.songIds);
                  setSongContextMenu(null);
                }}
              >
                Manage Tags
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  setMetadataTargetSongIds(songContextMenu.songIds);
                  setShowEditCommentDialog(true);
                  setSongContextMenu(null);
                }}
              >
                Edit Comment
              </button>
              <button
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
                onClick={() => {
                  setMetadataTargetSongIds(songContextMenu.songIds);
                  setShowCustomStartDialog(true);
                  setSongContextMenu(null);
                }}
              >
                Set Custom Start Time
              </button>
            </div>
          ) : null}
          <ManageTagsDialog
            isOpen={showManageTagsDialog}
            tags={tags}
            selectedTagIds={manageTagsSelection}
            targetSongCount={metadataTargetSongIds.length}
            onToggleTag={(tagId, checked) => {
              if (checked) {
                setManageTagsSelection((previous) => [...new Set([...previous, tagId])]);
              } else {
                setManageTagsSelection((previous) => previous.filter((value) => value !== tagId));
              }
            }}
            onClose={() => setShowManageTagsDialog(false)}
            onApply={() => {
              void applyManageTags();
            }}
          />
          <EditCommentDialog
            isOpen={showEditCommentDialog}
            initialComment={metadataTargetSongs[0]?.comment ?? null}
            targetSongCount={metadataTargetSongIds.length}
            onClose={() => setShowEditCommentDialog(false)}
            onSave={(comment) => {
              void applySongComment(comment);
            }}
          />
          <SetCustomStartDialog
            isOpen={showCustomStartDialog}
            initialMs={metadataTargetSongs[0]?.custom_start_ms ?? 0}
            currentPositionMs={usePlayerStore.getState().positionMs}
            targetSongCount={metadataTargetSongIds.length}
            onClose={() => setShowCustomStartDialog(false)}
            onSave={(customStartMs) => {
              void applyCustomStart(customStartMs);
            }}
          />
          <ItunesImportWizard
            isOpen={showImportWizard}
            step={importWizardStep}
            xmlPath={itunesXmlPath}
            preview={itunesPreview}
            options={itunesOptions}
            progress={itunesProgress}
            summary={itunesSummary}
            isImporting={isImporting}
            importProgressPercent={importProgressPercent}
            onClose={resetImportWizard}
            onPickXml={() => {
              void handlePickItunesXml();
            }}
            onSetStep={setImportWizardStep}
            onToggleOption={(key, value) =>
              setItunesOptions((previous) => ({
                ...previous,
                [key]: value,
              }))
            }
            onRunImport={() => {
              void handleRunItunesImport();
            }}
          />
        </div>

        <DragOverlay>
          {dragOverlayCount > 0 ? (
            <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-lg">
              <p className="text-sm font-medium">{dragOverlayLabel ?? "Dragging"}</p>
            </div>
          ) : null}
        </DragOverlay>

        <UpNextPanel
          isOpen={upNextOpen}
          nowPlaying={currentSong}
          upNext={upNext}
          playingFrom={playingFrom}
          playingFromLabel={playingFromLabel}
          onClose={closeUpNext}
          onRemoveUpNext={removeFromUpNext}
        />
      </DndContext>
    </TooltipProvider>
  );
}

export default App;
