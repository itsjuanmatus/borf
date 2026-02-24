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
  ChevronLeft,
  ChevronRight,
  Clock3,
  Disc3,
  Download,
  Folder,
  Library,
  ListMusic,
  Settings2,
  UserRound,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SongArtwork } from "./components/song-artwork";
import { Button } from "./components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
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
import { SearchPalette } from "./features/search/SearchPalette";
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
  SearchPaletteItem,
  SongListItem,
  SongSortField,
  SortOrder,
  Tag,
} from "./types";

const SONG_PAGE_SIZE = 250;
const PLAYLIST_PAGE_SIZE = 250;
const SONG_IDS_BATCH_SIZE = 400;
const SONG_ROW_HEIGHT = 54;
const SEARCH_DEBOUNCE_MS = 40;
const SEARCH_MIN_TEXT_LENGTH = 1;
const SEARCH_RESULT_LIMIT = 20;
const PALETTE_CATALOG_PAGE_SIZE = 1000;
const MAX_NAVIGATION_HISTORY = 100;
const SCROLL_RESTORE_MAX_ATTEMPTS = 12;
const PERF_TRACE_ENABLED = (() => {
  const rawValue = String(import.meta.env.VITE_PERF_TRACE ?? "").toLowerCase();
  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
})();

type AlbumIdentity = Pick<AlbumListItem, "album" | "album_artist">;

type NavigationRoute =
  | { kind: "songs" }
  | { kind: "albums-list" }
  | { kind: "albums-detail"; album: AlbumIdentity }
  | { kind: "artists-list" }
  | { kind: "artists-detail"; artist: string }
  | { kind: "artists-album-detail"; artist: string; album: AlbumIdentity }
  | { kind: "playlist"; playlistId: string }
  | { kind: "history" }
  | { kind: "stats" }
  | { kind: "settings" };

type NavigationScrollPositions = Record<string, number>;

interface NavigationSnapshot {
  route: NavigationRoute;
  searchQuery: string;
  selectedTagFilterIds: string[];
  playlistReorderMode: boolean;
  upNextOpen: boolean;
  scrollByRoute: NavigationScrollPositions;
}

function cloneAlbumIdentity(album: AlbumIdentity): AlbumIdentity {
  return {
    album: album.album,
    album_artist: album.album_artist,
  };
}

function normalizeTagFilterIds(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalizeScrollPosition(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function isSameAlbumIdentity(left: AlbumIdentity, right: AlbumIdentity) {
  return left.album === right.album && left.album_artist === right.album_artist;
}

function navigationRouteKey(route: NavigationRoute) {
  switch (route.kind) {
    case "songs":
      return "songs";
    case "albums-list":
      return "albums-list";
    case "albums-detail":
      return `albums-detail:${encodeURIComponent(route.album.album)}:${encodeURIComponent(route.album.album_artist)}`;
    case "artists-list":
      return "artists-list";
    case "artists-detail":
      return `artists-detail:${encodeURIComponent(route.artist)}`;
    case "artists-album-detail":
      return `artists-album-detail:${encodeURIComponent(route.artist)}:${encodeURIComponent(route.album.album)}:${encodeURIComponent(route.album.album_artist)}`;
    case "playlist":
      return `playlist:${route.playlistId}`;
    case "history":
      return "history";
    case "stats":
      return "stats";
    case "settings":
      return "settings";
    default:
      throw new Error(`Unhandled route kind: ${(route as { kind: string }).kind}`);
  }
}

function navigationRoutesEqual(left: NavigationRoute, right: NavigationRoute) {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "songs":
    case "albums-list":
    case "artists-list":
    case "history":
    case "stats":
    case "settings":
      return true;
    case "albums-detail":
      return isSameAlbumIdentity(
        left.album,
        (right as Extract<NavigationRoute, { kind: "albums-detail" }>).album,
      );
    case "artists-detail":
      return left.artist === (right as Extract<NavigationRoute, { kind: "artists-detail" }>).artist;
    case "artists-album-detail":
      return (
        left.artist ===
          (right as Extract<NavigationRoute, { kind: "artists-album-detail" }>).artist &&
        isSameAlbumIdentity(
          left.album,
          (right as Extract<NavigationRoute, { kind: "artists-album-detail" }>).album,
        )
      );
    case "playlist":
      return (
        left.playlistId === (right as Extract<NavigationRoute, { kind: "playlist" }>).playlistId
      );
    default:
      return false;
  }
}

function navigationSnapshotsEqual(left: NavigationSnapshot, right: NavigationSnapshot) {
  return (
    navigationRoutesEqual(left.route, right.route) &&
    left.searchQuery === right.searchQuery &&
    left.playlistReorderMode === right.playlistReorderMode &&
    left.upNextOpen === right.upNextOpen &&
    left.selectedTagFilterIds.length === right.selectedTagFilterIds.length &&
    left.selectedTagFilterIds.every((tagId, index) => tagId === right.selectedTagFilterIds[index])
  );
}

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

function splitSearchQueryTerms(query: string) {
  const textTerms: string[] = [];
  let inlineTagCount = 0;

  for (const rawTerm of query.split(/\s+/)) {
    if (!rawTerm) {
      continue;
    }
    if (rawTerm.toLowerCase().startsWith("tag:")) {
      const value = rawTerm.split(":").slice(1).join(":").trim();
      if (value.length > 0) {
        inlineTagCount += 1;
      }
      continue;
    }
    textTerms.push(rawTerm);
  }

  return {
    textQuery: textTerms.join(" ").trim(),
    inlineTagCount,
  };
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
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
  const [isSearchPaletteOpen, setIsSearchPaletteOpen] = useState(false);
  const [paletteCatalogSongs, setPaletteCatalogSongs] = useState<SongListItem[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagFilterIds, setSelectedTagFilterIds] = useState<string[]>([]);

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
  const activePlaylistRequestIdRef = useRef(0);
  const perfPlaylistOpenRef = useRef<{ playlistId: string; startedAt: number } | null>(null);
  const perfPlayRequestRef = useRef<{ songId: string; startedAt: number } | null>(null);
  const perfViewSwitchRef = useRef<{ view: string; startedAt: number } | null>(null);
  const queueHydrationTokenRef = useRef(0);
  const pendingQueueHydrationRef = useRef<{ token: number; promise: Promise<void> } | null>(null);
  const latestSearchTokenRef = useRef(0);
  const paletteCatalogTokenRef = useRef(0);
  const scrollPositionsRef = useRef<NavigationScrollPositions>({});
  const pendingScrollRestoreRef = useRef<{
    route: NavigationRoute;
    scrollByRoute: NavigationScrollPositions;
  } | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const pastStackRef = useRef<NavigationSnapshot[]>([]);
  const futureStackRef = useRef<NavigationSnapshot[]>([]);

  const [albumGridWidth, setAlbumGridWidth] = useState(920);
  const [playlistReorderMode, setPlaylistReorderMode] = useState(false);
  const [songsOrderedIds, setSongsOrderedIds] = useState<string[]>([]);
  const [playlistTrackIdsByPlaylistId, setPlaylistTrackIdsByPlaylistId] = useState<
    Record<string, string[]>
  >({});
  const [statsRefreshSignal, setStatsRefreshSignal] = useState(0);
  const [pastStack, setPastStack] = useState<NavigationSnapshot[]>([]);
  const [futureStack, setFutureStack] = useState<NavigationSnapshot[]>([]);
  const [playlistRestoreScrollTop, setPlaylistRestoreScrollTop] = useState<number | null>(null);
  const [historyRestoreScrollTop, setHistoryRestoreScrollTop] = useState<number | null>(null);
  const [scrollRestoreTick, setScrollRestoreTick] = useState(0);

  const { onSongStarted, onPositionUpdate, onPaused, onResumed, onTrackEnded } = usePlayTracking();
  const triggerStatsRefresh = useCallback(() => {
    setStatsRefreshSignal((current) => current + 1);
  }, []);

  const loadedSongPagesRef = useRef<Set<number>>(new Set());
  const loadingSongPagesRef = useRef<Set<number>>(new Set());
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);
  const debouncedSearchParts = useMemo(
    () => splitSearchQueryTerms(debouncedSearchQuery),
    [debouncedSearchQuery],
  );
  const canRunDebouncedSearch = useMemo(() => {
    if (!debouncedSearchQuery) {
      return false;
    }
    if (selectedTagFilterIds.length > 0 || debouncedSearchParts.inlineTagCount > 0) {
      return true;
    }
    return debouncedSearchParts.textQuery.length >= SEARCH_MIN_TEXT_LENGTH;
  }, [
    debouncedSearchParts.inlineTagCount,
    debouncedSearchParts.textQuery.length,
    debouncedSearchQuery,
    selectedTagFilterIds.length,
  ]);

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
  const songVirtualRows = songVirtualizer.getVirtualItems();

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
  const activeFolderChildren = useMemo(() => {
    if (!activePlaylist?.is_folder) {
      return [] as PlaylistNode[];
    }
    return playlists
      .filter((playlist) => playlist.parent_id === activePlaylist.id)
      .sort((left, right) => {
        if (left.sort_order !== right.sort_order) {
          return left.sort_order - right.sort_order;
        }
        return left.name.localeCompare(right.name);
      });
  }, [activePlaylist, playlists]);
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
  const paletteLocalSongs = useMemo(() => {
    if (paletteCatalogSongs.length > 0) {
      return paletteCatalogSongs;
    }
    return Array.from(songLookupById.values());
  }, [paletteCatalogSongs, songLookupById]);
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

  const refreshPaletteCatalogSongs = useCallback(async () => {
    const token = paletteCatalogTokenRef.current + 1;
    paletteCatalogTokenRef.current = token;

    const totalSongCount = await libraryApi.getSongCount();
    if (totalSongCount <= 0) {
      if (token === paletteCatalogTokenRef.current) {
        setPaletteCatalogSongs([]);
      }
      return;
    }

    const songs: SongListItem[] = [];
    for (let offset = 0; offset < totalSongCount; offset += PALETTE_CATALOG_PAGE_SIZE) {
      const chunk = await libraryApi.getSongs({
        limit: PALETTE_CATALOG_PAGE_SIZE,
        offset,
        sort: "title",
        order: "asc",
      });
      if (token !== paletteCatalogTokenRef.current) {
        return;
      }
      songs.push(...chunk);
      if (chunk.length < PALETTE_CATALOG_PAGE_SIZE) {
        break;
      }
    }

    if (token === paletteCatalogTokenRef.current) {
      setPaletteCatalogSongs(songs);
    }
  }, []);

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

  const loadSongsByIdsInBatches = useCallback(async (songIds: string[]) => {
    const dedupedSongIds = Array.from(new Set(songIds));
    if (dedupedSongIds.length === 0) {
      return [] as SongListItem[];
    }

    const result: SongListItem[] = [];
    for (let offset = 0; offset < dedupedSongIds.length; offset += SONG_IDS_BATCH_SIZE) {
      const batch = dedupedSongIds.slice(offset, offset + SONG_IDS_BATCH_SIZE);
      const chunk = await libraryApi.getSongsByIds(batch);
      result.push(...chunk);
    }

    return result;
  }, []);

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

      perfPlayRequestRef.current = { songId: song.id, startedAt: performance.now() };
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
    async (song: SongListItem, startMs?: number, requestToken?: number) => {
      const activeToken = requestToken ?? beginPlaybackRequest();
      if (!isPlaybackRequestCurrent(activeToken)) {
        return;
      }
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      perfPlayRequestRef.current = { songId: song.id, startedAt: performance.now() };
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
      setNowPlaying,
      setPlaybackState,
      setPosition,
      onSongStarted,
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
    [persistQueue, playSong, queue, queueSourceLabel, setCurrentIndex, setPlayingFrom],
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

  const openAlbum = useCallback(
    async (album: AlbumIdentity, options?: { allowToggle?: boolean }) => {
      const allowToggle = options?.allowToggle ?? true;
      if (
        allowToggle &&
        selectedAlbum &&
        selectedAlbum.album === album.album &&
        selectedAlbum.album_artist === album.album_artist
      ) {
        setSelectedAlbum(null);
        setAlbumTracks([]);
        return;
      }

      const resolvedAlbum = albums.find(
        (entry) => entry.album === album.album && entry.album_artist === album.album_artist,
      );
      const fallbackAlbumByName = albums
        .filter((entry) => entry.album === album.album)
        .sort((left, right) => {
          if (right.song_count !== left.song_count) {
            return right.song_count - left.song_count;
          }
          return left.album_artist.localeCompare(right.album_artist);
        })[0];
      const effectiveAlbum = resolvedAlbum ??
        fallbackAlbumByName ?? {
          album: album.album,
          album_artist: album.album_artist,
          song_count: 0,
          total_duration_ms: 0,
          artwork_path: null,
          year: null,
          date_added: null,
        };

      setSelectedAlbum(effectiveAlbum);
      setLoadingAlbumTracks(true);
      setAlbumTracks([]);

      try {
        const tracks = await libraryApi.getAlbumTracks({
          album: effectiveAlbum.album,
          albumArtist: effectiveAlbum.album_artist,
        });
        setAlbumTracks(tracks);
      } finally {
        setLoadingAlbumTracks(false);
      }
    },
    [albums, selectedAlbum],
  );

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

  const openArtistAlbum = useCallback(
    async (album: AlbumIdentity) => {
      const resolvedAlbum = artistAlbums.find(
        (entry) => entry.album === album.album && entry.album_artist === album.album_artist,
      ) ?? {
        album: album.album,
        album_artist: album.album_artist,
        song_count: 0,
        total_duration_ms: 0,
        artwork_path: null,
        year: null,
        date_added: null,
      };

      setSelectedArtistAlbum(resolvedAlbum);
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
    },
    [artistAlbums],
  );

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
    (
      playlistId: string,
      options?: {
        clearSelection?: boolean;
        reorderMode?: boolean;
      },
    ) => {
      const startedAt = performance.now();
      perfViewSwitchRef.current = { view: "playlist", startedAt };
      perfPlaylistOpenRef.current = { playlistId, startedAt };
      setPlaylistReorderMode(options?.reorderMode ?? false);
      setActiveView("playlist");
      setActivePlaylistId(playlistId);
      setSelectedAlbum(null);
      setSelectedArtist(null);
      setSelectedArtistAlbum(null);
      if (options?.clearSelection ?? true) {
        clearSelection();
      }
    },
    [clearSelection, setActivePlaylistId, setActiveView],
  );

  const currentRoute = useMemo<NavigationRoute>(() => {
    if (activeView === "songs") {
      return { kind: "songs" };
    }

    if (activeView === "albums") {
      if (selectedAlbum) {
        return {
          kind: "albums-detail",
          album: cloneAlbumIdentity(selectedAlbum),
        };
      }
      return { kind: "albums-list" };
    }

    if (activeView === "artists") {
      if (selectedArtist && selectedArtistAlbum) {
        return {
          kind: "artists-album-detail",
          artist: selectedArtist,
          album: cloneAlbumIdentity(selectedArtistAlbum),
        };
      }
      if (selectedArtist) {
        return {
          kind: "artists-detail",
          artist: selectedArtist,
        };
      }
      return { kind: "artists-list" };
    }

    if (activeView === "playlist" && activePlaylistId) {
      return {
        kind: "playlist",
        playlistId: activePlaylistId,
      };
    }

    if (activeView === "history") {
      return { kind: "history" };
    }

    if (activeView === "stats") {
      return { kind: "stats" };
    }

    if (activeView === "settings") {
      return { kind: "settings" };
    }

    return { kind: "songs" };
  }, [activePlaylistId, activeView, selectedAlbum, selectedArtist, selectedArtistAlbum]);
  const currentRouteKey = useMemo(() => navigationRouteKey(currentRoute), [currentRoute]);

  const setPastStackWithRef = useCallback((next: NavigationSnapshot[]) => {
    pastStackRef.current = next;
    setPastStack(next);
  }, []);

  const setFutureStackWithRef = useCallback((next: NavigationSnapshot[]) => {
    futureStackRef.current = next;
    setFutureStack(next);
  }, []);

  const resolveScrollElementForRoute = useCallback(
    (route: NavigationRoute) => {
      switch (route.kind) {
        case "songs":
          return songsScrollRef.current;
        case "albums-list":
          return albumsScrollRef.current;
        case "albums-detail":
          return albumDetailScrollRef.current;
        case "artists-list":
          return artistsScrollRef.current;
        case "artists-detail":
          return artistAlbumsScrollRef.current;
        case "artists-album-detail":
          return artistAlbumTracksScrollRef.current;
        case "playlist":
          if (activePlaylistId !== route.playlistId) {
            return null;
          }
          if (activePlaylist?.is_folder) {
            return playlistFolderScrollRef.current;
          }
          return null;
        case "stats":
          return statsScrollRef.current;
        case "settings":
          return settingsScrollRef.current;
        case "history":
          return null;
        default:
          return null;
      }
    },
    [activePlaylist?.is_folder, activePlaylistId],
  );

  const recordScrollPositionForRoute = useCallback((route: NavigationRoute, scrollTop: number) => {
    const key = navigationRouteKey(route);
    scrollPositionsRef.current[key] = normalizeScrollPosition(scrollTop);
  }, []);

  const syncScrollPositionForRoute = useCallback(
    (route: NavigationRoute) => {
      const element = resolveScrollElementForRoute(route);
      if (!element) {
        return;
      }
      recordScrollPositionForRoute(route, element.scrollTop);
    },
    [recordScrollPositionForRoute, resolveScrollElementForRoute],
  );

  const createSnapshotForRoute = useCallback(
    (
      route: NavigationRoute,
      overrides?: Partial<
        Pick<
          NavigationSnapshot,
          "searchQuery" | "selectedTagFilterIds" | "playlistReorderMode" | "upNextOpen"
        >
      >,
    ): NavigationSnapshot => {
      const routeKey = navigationRouteKey(route);
      const normalizedTagIds = normalizeTagFilterIds(
        overrides?.selectedTagFilterIds ?? selectedTagFilterIds,
      );
      const snapshot: NavigationSnapshot = {
        route,
        searchQuery: overrides?.searchQuery ?? searchQuery,
        selectedTagFilterIds: normalizedTagIds,
        playlistReorderMode:
          overrides?.playlistReorderMode ??
          (route.kind === "playlist" ? playlistReorderMode : false),
        upNextOpen: overrides?.upNextOpen ?? upNextOpen,
        scrollByRoute: {
          ...scrollPositionsRef.current,
        },
      };
      if (snapshot.scrollByRoute[routeKey] === undefined) {
        snapshot.scrollByRoute[routeKey] = 0;
      }
      return snapshot;
    },
    [playlistReorderMode, searchQuery, selectedTagFilterIds, upNextOpen],
  );

  const captureCurrentSnapshot = useCallback(() => {
    syncScrollPositionForRoute(currentRoute);
    return createSnapshotForRoute(currentRoute);
  }, [createSnapshotForRoute, currentRoute, syncScrollPositionForRoute]);

  const applyRoute = useCallback(
    async (route: NavigationRoute) => {
      if (route.kind === "songs") {
        perfViewSwitchRef.current = { view: "songs", startedAt: performance.now() };
        setActiveView("songs");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
        return;
      }

      if (route.kind === "albums-list") {
        perfViewSwitchRef.current = { view: "albums", startedAt: performance.now() };
        setActiveView("albums");
        setActivePlaylistId(null);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        clearSelection();
        return;
      }

      if (route.kind === "albums-detail") {
        perfViewSwitchRef.current = { view: "albums", startedAt: performance.now() };
        setActiveView("albums");
        setActivePlaylistId(null);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
        await openAlbum(route.album, { allowToggle: false });
        return;
      }

      if (route.kind === "artists-list") {
        perfViewSwitchRef.current = { view: "artists", startedAt: performance.now() };
        setActiveView("artists");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
        return;
      }

      if (route.kind === "artists-detail") {
        perfViewSwitchRef.current = { view: "artists", startedAt: performance.now() };
        setActiveView("artists");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        clearSelection();
        await openArtist(route.artist);
        return;
      }

      if (route.kind === "artists-album-detail") {
        perfViewSwitchRef.current = { view: "artists", startedAt: performance.now() };
        setActiveView("artists");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        clearSelection();
        await openArtist(route.artist);
        await openArtistAlbum(route.album);
        return;
      }

      if (route.kind === "playlist") {
        openPlaylist(route.playlistId, {
          clearSelection: true,
          reorderMode: false,
        });
        return;
      }

      if (route.kind === "settings") {
        perfViewSwitchRef.current = { view: "settings", startedAt: performance.now() };
        setActiveView("settings");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
        return;
      }

      if (route.kind === "history") {
        setActiveView("history");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
        return;
      }

      if (route.kind === "stats") {
        setActiveView("stats");
        setActivePlaylistId(null);
        setSelectedAlbum(null);
        setAlbumTracks([]);
        setSelectedArtist(null);
        setSelectedArtistAlbum(null);
        setArtistAlbums([]);
        setArtistAlbumTracks([]);
        clearSelection();
      }
    },
    [
      clearSelection,
      openAlbum,
      openArtist,
      openArtistAlbum,
      openPlaylist,
      setActivePlaylistId,
      setActiveView,
    ],
  );

  const applySnapshot = useCallback(
    async (snapshot: NavigationSnapshot, options?: { fromHistory?: boolean }) => {
      const fromHistory = options?.fromHistory ?? false;
      isApplyingHistoryRef.current = fromHistory;
      try {
        setSearchQuery(snapshot.searchQuery);
        setSelectedTagFilterIds(normalizeTagFilterIds(snapshot.selectedTagFilterIds));
        if (snapshot.upNextOpen) {
          openUpNext();
        } else {
          closeUpNext();
        }

        await applyRoute(snapshot.route);

        if (snapshot.route.kind === "playlist") {
          setPlaylistReorderMode(snapshot.playlistReorderMode);
          const playlistKey = navigationRouteKey(snapshot.route);
          setPlaylistRestoreScrollTop(snapshot.scrollByRoute[playlistKey] ?? 0);
        } else {
          setPlaylistReorderMode(false);
          setPlaylistRestoreScrollTop(null);
        }

        if (snapshot.route.kind === "history") {
          const historyKey = navigationRouteKey(snapshot.route);
          setHistoryRestoreScrollTop(snapshot.scrollByRoute[historyKey] ?? 0);
        } else {
          setHistoryRestoreScrollTop(null);
        }

        pendingScrollRestoreRef.current = {
          route: snapshot.route,
          scrollByRoute: {
            ...snapshot.scrollByRoute,
          },
        };
        setScrollRestoreTick((previous) => previous + 1);
      } catch (error: unknown) {
        setErrorMessage(String(error));
      } finally {
        if (fromHistory) {
          isApplyingHistoryRef.current = false;
        }
      }
    },
    [applyRoute, closeUpNext, openUpNext],
  );

  const pushHistoryForExplicitNav = useCallback(
    (nextSnapshot: NavigationSnapshot) => {
      const currentSnapshot = captureCurrentSnapshot();
      if (navigationSnapshotsEqual(currentSnapshot, nextSnapshot)) {
        return false;
      }

      const nextPast = [...pastStackRef.current];
      if (
        nextPast.length === 0 ||
        !navigationSnapshotsEqual(nextPast[nextPast.length - 1], currentSnapshot)
      ) {
        nextPast.push(currentSnapshot);
      }
      if (nextPast.length > MAX_NAVIGATION_HISTORY) {
        nextPast.splice(0, nextPast.length - MAX_NAVIGATION_HISTORY);
      }
      setPastStackWithRef(nextPast);
      setFutureStackWithRef([]);
      return true;
    },
    [captureCurrentSnapshot, setFutureStackWithRef, setPastStackWithRef],
  );

  const navigateExplicit = useCallback(
    (nextSnapshot: NavigationSnapshot) => {
      if (isApplyingHistoryRef.current) {
        return;
      }
      const didPush = pushHistoryForExplicitNav(nextSnapshot);
      if (!didPush) {
        return;
      }
      void applySnapshot(nextSnapshot);
    },
    [applySnapshot, pushHistoryForExplicitNav],
  );

  const goBack = useCallback(() => {
    if (isApplyingHistoryRef.current) {
      return;
    }

    const previousStack = pastStackRef.current;
    if (previousStack.length === 0) {
      return;
    }

    const currentSnapshot = captureCurrentSnapshot();
    const targetSnapshot = previousStack[previousStack.length - 1];
    const nextPast = previousStack.slice(0, -1);
    const nextFuture = [currentSnapshot, ...futureStackRef.current];
    if (nextFuture.length > MAX_NAVIGATION_HISTORY) {
      nextFuture.splice(MAX_NAVIGATION_HISTORY);
    }

    setPastStackWithRef(nextPast);
    setFutureStackWithRef(nextFuture);
    void applySnapshot(targetSnapshot, { fromHistory: true });
  }, [applySnapshot, captureCurrentSnapshot, setFutureStackWithRef, setPastStackWithRef]);

  const goForward = useCallback(() => {
    if (isApplyingHistoryRef.current) {
      return;
    }

    const nextStack = futureStackRef.current;
    if (nextStack.length === 0) {
      return;
    }

    const currentSnapshot = captureCurrentSnapshot();
    const targetSnapshot = nextStack[0];
    const remainingForward = nextStack.slice(1);
    const nextPast = [...pastStackRef.current, currentSnapshot];
    if (nextPast.length > MAX_NAVIGATION_HISTORY) {
      nextPast.splice(0, nextPast.length - MAX_NAVIGATION_HISTORY);
    }

    setFutureStackWithRef(remainingForward);
    setPastStackWithRef(nextPast);
    void applySnapshot(targetSnapshot, { fromHistory: true });
  }, [applySnapshot, captureCurrentSnapshot, setFutureStackWithRef, setPastStackWithRef]);

  const navigateToRoute = useCallback(
    (
      route: NavigationRoute,
      overrides?: Partial<
        Pick<
          NavigationSnapshot,
          "searchQuery" | "selectedTagFilterIds" | "playlistReorderMode" | "upNextOpen"
        >
      >,
    ) => {
      const nextSnapshot = createSnapshotForRoute(route, overrides);
      navigateExplicit(nextSnapshot);
    },
    [createSnapshotForRoute, navigateExplicit],
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
          navigateToRoute(
            {
              kind: "playlist",
              playlistId: created.id,
            },
            { playlistReorderMode: false },
          );
        }
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [navigateToRoute, refreshPlaylists],
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
        navigateToRoute(
          {
            kind: "playlist",
            playlistId: duplicated.id,
          },
          { playlistReorderMode: false },
        );
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [invalidatePlaylistsCache, navigateToRoute, refreshPlaylists],
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
        const freshSongs = await loadSongsByIdsInBatches(deduped);
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
    [loadSongsByIdsInBatches, songLookupById],
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

  const handleExecuteSearchPaletteItem = useCallback(
    async (item: SearchPaletteItem, context: { items: SearchPaletteItem[] }) => {
      const executeNonActionItem = async (targetItem: SearchPaletteItem | null) => {
        if (!targetItem) {
          return;
        }

        if (targetItem.kind === "song" && targetItem.song) {
          setQueueSourceSongs([targetItem.song]);
          setQueueSourceLabel("Search Palette");
          await replaceQueueAndPlay([targetItem.song], 0);
          return;
        }

        if (targetItem.kind === "album" && targetItem.album) {
          await applyRoute({
            kind: "albums-detail",
            album: {
              album: targetItem.album.album,
              album_artist: targetItem.album.album_artist,
            },
          });
          return;
        }

        if (targetItem.kind === "artist" && targetItem.artist) {
          await applyRoute({
            kind: "artists-detail",
            artist: targetItem.artist,
          });
          return;
        }

        if (
          (targetItem.kind === "playlist" || targetItem.kind === "folder") &&
          targetItem.playlist
        ) {
          openPlaylist(targetItem.playlist.id);
        }
      };

      if (item.kind !== "action") {
        await executeNonActionItem(item);
        return;
      }

      switch (item.action_id) {
        case "action.play_top_result": {
          const topResult = context.items.find((candidate) => candidate.kind !== "action") ?? null;
          await executeNonActionItem(topResult);
          break;
        }
        case "action.queue_top_song": {
          const topSong = context.items.find((candidate) => candidate.song)?.song ?? null;
          if (!topSong) {
            return;
          }
          enqueueSongs([topSong]);
          setStatusMessage(`Queued ${topSong.title}`);
          break;
        }
        case "action.open_songs":
          await applyRoute({ kind: "songs" });
          break;
        case "action.open_albums":
          await applyRoute({ kind: "albums-list" });
          break;
        case "action.open_artists":
          await applyRoute({ kind: "artists-list" });
          break;
        case "action.open_playlists": {
          const fallbackPlaylistId =
            activePlaylistId ??
            playlists.find((playlist) => !playlist.is_folder)?.id ??
            playlists.find((playlist) => playlist.is_folder)?.id ??
            null;
          if (!fallbackPlaylistId) {
            setStatusMessage("No playlists available yet.");
            break;
          }
          openPlaylist(fallbackPlaylistId);
          break;
        }
        case "action.open_settings":
          await applyRoute({ kind: "settings" });
          break;
        case "action.open_history":
          await applyRoute({ kind: "history" });
          break;
        case "action.open_stats":
          await applyRoute({ kind: "stats" });
          break;
        case "action.scan_music_folder":
          await handlePickFolderAndScan();
          break;
        case "action.import_itunes_library":
          setShowImportWizard(true);
          setImportWizardStep(1);
          setErrorMessage(null);
          break;
        default:
          break;
      }
    },
    [
      activePlaylistId,
      applyRoute,
      enqueueSongs,
      handlePickFolderAndScan,
      openPlaylist,
      playlists,
      replaceQueueAndPlay,
    ],
  );

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
      setPlayingFrom,
      setQueue,
      songLookupById,
    ],
  );

  const removeSelectedFromActivePlaylist = useCallback(async () => {
    if (!activePlaylistId || activePlaylist?.is_folder || selectedSongIds.length === 0) {
      return;
    }
    try {
      await playlistApi.removeSongs(activePlaylistId, selectedSongIds);
      await refreshPlaylistTracks(activePlaylistId);
      clearSelection();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [
    activePlaylist?.is_folder,
    activePlaylistId,
    clearSelection,
    refreshPlaylistTracks,
    selectedSongIds,
  ]);

  const currentSong = useMemo(
    () => nowPlaying ?? (currentIndex !== null ? (queue[currentIndex] ?? null) : null),
    [currentIndex, nowPlaying, queue],
  );
  const canReorderActivePlaylist = useMemo(() => {
    if (!activePlaylistId || activePlaylist?.is_folder) {
      return false;
    }
    if (activePlaylistTrackCount === 0) {
      return true;
    }
    const loadedPages = loadedPagesByPlaylistId[activePlaylistId] ?? [];
    const expectedPages = Math.ceil(activePlaylistTrackCount / PLAYLIST_PAGE_SIZE);
    return loadedPages.length >= expectedPages;
  }, [
    activePlaylist?.is_folder,
    activePlaylistId,
    activePlaylistTrackCount,
    loadedPagesByPlaylistId,
  ]);

  const togglePlaylistReorderMode = useCallback(() => {
    if (!activePlaylistId || activePlaylist?.is_folder) {
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
  }, [
    activePlaylist?.is_folder,
    activePlaylistId,
    activePlaylistTrackCount,
    ensurePlaylistPage,
    playlistReorderMode,
  ]);

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
    const token = latestSearchTokenRef.current + 1;
    latestSearchTokenRef.current = token;

    if (!debouncedSearchQuery) {
      setSearchResults(null);
      return;
    }

    if (!canRunDebouncedSearch) {
      setSearchResults(null);
      return;
    }

    void libraryApi
      .search(debouncedSearchQuery, SEARCH_RESULT_LIMIT, selectedTagFilterIds)
      .then((result) => {
        if (token !== latestSearchTokenRef.current) {
          return;
        }
        setSearchResults(result);
      })
      .catch((error: unknown) => {
        if (token !== latestSearchTokenRef.current) {
          return;
        }
        setErrorMessage(String(error));
      });
  }, [canRunDebouncedSearch, debouncedSearchQuery, selectedTagFilterIds]);

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
    if (!isSearchPaletteOpen) {
      paletteCatalogTokenRef.current += 1;
      return;
    }

    if (paletteCatalogSongs.length > 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPaletteCatalogSongs().catch((error: unknown) => setErrorMessage(String(error)));
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isSearchPaletteOpen, paletteCatalogSongs.length, refreshPaletteCatalogSongs]);

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
    if (activeView !== "playlist" || !activePlaylistId || activePlaylist?.is_folder) {
      return;
    }
    const requestId = activePlaylistRequestIdRef.current + 1;
    activePlaylistRequestIdRef.current = requestId;
    void refreshPlaylistTracks(activePlaylistId, requestId).catch((error: unknown) =>
      setErrorMessage(String(error)),
    );
  }, [activePlaylist?.is_folder, activePlaylistId, activeView, refreshPlaylistTracks]);

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
    queueCurrentIndex,
    loadSongsByIdsInBatches,
    queueSongIds,
    queueSourceLabel,
    setCurrentIndex,
    setNowPlaying,
    setPlayingFrom,
    setQueue,
  ]);

  useEffect(() => {
    if (activeView !== "songs" || songCount === 0) {
      return;
    }

    if (songVirtualRows.length === 0) {
      void ensureSongPage(0);
      return;
    }

    const first = songVirtualRows[0].index;
    const last = songVirtualRows[songVirtualRows.length - 1].index;
    const firstPage = Math.floor(first / SONG_PAGE_SIZE);
    const lastPage = Math.floor(last / SONG_PAGE_SIZE);

    for (let page = firstPage - 1; page <= lastPage + 1; page += 1) {
      if (page >= 0) {
        void ensureSongPage(page);
      }
    }
  }, [activeView, ensureSongPage, songCount, songVirtualRows]);

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
  }, [handlePickFolderAndScan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.metaKey || event.ctrlKey;
      const lowerKey = event.key.toLowerCase();
      const inEditableTarget = isEditableKeyboardTarget(event.target);
      const isBackShortcut =
        (event.altKey && event.key === "ArrowLeft") ||
        (hasModifier && !event.shiftKey && event.key === "[");
      const isForwardShortcut =
        (event.altKey && event.key === "ArrowRight") ||
        (hasModifier && !event.shiftKey && event.key === "]");

      if (hasModifier && lowerKey === "k") {
        event.preventDefault();
        setIsSearchPaletteOpen((previous) => !previous);
        return;
      }

      if (!hasModifier && !event.altKey && event.key === "Escape") {
        if (isSearchPaletteOpen) {
          event.preventDefault();
          setIsSearchPaletteOpen(false);
          return;
        }
        closeUpNext();
        return;
      }

      if (inEditableTarget) {
        return;
      }

      if (isBackShortcut) {
        event.preventDefault();
        goBack();
        return;
      }

      if (isForwardShortcut) {
        event.preventDefault();
        goForward();
        return;
      }

      if (!hasModifier) {
        return;
      }

      const handlers: Record<string, () => void> = {
        c: () => {
          if (selectedSongIds.length === 0) {
            return;
          }
          copySelectionToClipboard();
          setClipboardHint(`${selectedSongIds.length} song(s) copied`);
        },
        v: () => {
          if (clipboardSongIds.length === 0) {
            return;
          }

          if (activeView !== "playlist" || !activePlaylistId || activePlaylist?.is_folder) {
            setClipboardHint("Paste only works while viewing a playlist");
            return;
          }

          void playlistApi
            .addSongs({ playlistId: activePlaylistId, songIds: clipboardSongIds })
            .then(() => refreshPlaylistTracks(activePlaylistId))
            .then(() => setClipboardHint(`${clipboardSongIds.length} song(s) pasted`))
            .catch((error: unknown) => setErrorMessage(String(error)));
        },
      };

      const handler = handlers[lowerKey];
      if (!handler) {
        if (event.key === "Escape") {
          closeUpNext();
        }
        return;
      }

      if (lowerKey === "c" && selectedSongIds.length === 0) {
        return;
      }
      if (lowerKey === "v" && clipboardSongIds.length === 0) {
        return;
      }

      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activePlaylist?.is_folder,
    activePlaylistId,
    activeView,
    clipboardSongIds,
    closeUpNext,
    copySelectionToClipboard,
    goBack,
    goForward,
    isSearchPaletteOpen,
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

  useLayoutEffect(() => {
    if (!songContextMenu || !contextMenuRef.current) {
      setContextMenuPos(null);
      return;
    }
    const el = contextMenuRef.current;
    const pad = 8;
    const left = Math.max(pad, Math.min(songContextMenu.x, window.innerWidth - el.offsetWidth - pad));
    const top = Math.max(pad, Math.min(songContextMenu.y, window.innerHeight - el.offsetHeight - pad));
    setContextMenuPos({ left, top });
  }, [songContextMenu]);

  useEffect(() => {
    if (scrollRestoreTick < 0) {
      return;
    }

    const pending = pendingScrollRestoreRef.current;
    if (!pending) {
      return;
    }

    const pendingRouteKey = navigationRouteKey(pending.route);
    if (pendingRouteKey !== currentRouteKey) {
      return;
    }

    if (pending.route.kind === "history") {
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (pending.route.kind === "playlist" && !activePlaylist?.is_folder) {
      pendingScrollRestoreRef.current = null;
      return;
    }

    const targetScrollTop = normalizeScrollPosition(pending.scrollByRoute[pendingRouteKey] ?? 0);
    let attempts = 0;
    let frame = 0;

    const applyRestore = () => {
      const element = resolveScrollElementForRoute(pending.route);
      if (!element) {
        if (attempts >= SCROLL_RESTORE_MAX_ATTEMPTS) {
          pendingScrollRestoreRef.current = null;
          return;
        }
        attempts += 1;
        frame = window.requestAnimationFrame(applyRestore);
        return;
      }

      element.scrollTop = targetScrollTop;
      if (
        Math.abs(element.scrollTop - targetScrollTop) <= 1 ||
        attempts >= SCROLL_RESTORE_MAX_ATTEMPTS
      ) {
        pendingScrollRestoreRef.current = null;
        return;
      }

      attempts += 1;
      frame = window.requestAnimationFrame(applyRestore);
    };

    frame = window.requestAnimationFrame(applyRestore);
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [activePlaylist?.is_folder, currentRouteKey, resolveScrollElementForRoute, scrollRestoreTick]);

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
          <TransportBar
            currentSong={currentSong}
            queueLength={queue.length}
            songCount={songCount}
            upNextCount={upNext.length}
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
            onSeek={(nextPosition, nextDurationMs) => {
              setPosition(nextPosition, nextDurationMs);
              void audioApi
                .seek(nextPosition)
                .catch((error: unknown) => setErrorMessage(String(error)));
            }}
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
                <aside className="h-full overflow-y-auto bg-surface-dark p-4">
                  <div className="mb-6 flex items-center gap-2">
                    <div className="rounded-full bg-leaf/80 p-2 text-cloud">
                      <Waves className="h-4 w-4" />
                    </div>
                    <div>
                      <h1 className="text-lg font-semibold tracking-tight text-cloud">borf</h1>
                      <p className="text-xs text-muted-on-dark">
                        Phase 4 metadata + tags + auto-sync
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-1 text-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
                      Library
                    </p>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "songs"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "songs" });
                      }}
                    >
                      <Library className="h-4 w-4" />
                      Songs
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "albums"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "albums-list" });
                      }}
                    >
                      <Disc3 className="h-4 w-4" />
                      Albums
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "artists"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "artists-list" });
                      }}
                    >
                      <UserRound className="h-4 w-4" />
                      Artists
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "settings"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "settings" });
                      }}
                    >
                      <Settings2 className="h-4 w-4" />
                      Settings
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "history"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "history" });
                      }}
                    >
                      <Clock3 className="h-4 w-4" />
                      History
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
                        activeView === "stats"
                          ? "bg-leaf/25 text-cloud"
                          : "text-muted-on-dark hover:bg-cloud/8",
                      )}
                      onClick={() => {
                        navigateToRoute({ kind: "stats" });
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
                      navigateToRoute(
                        {
                          kind: "playlist",
                          playlistId,
                        },
                        { playlistReorderMode: false },
                      );
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

                  <div className="mt-4 rounded-xl bg-cloud/5 p-3 text-xs text-muted-on-dark">
                    <p className="font-medium text-cloud">Status</p>
                    {isScanning ? (
                      <p className="mt-1 text-accent">Scanning in progress...</p>
                    ) : null}
                    <p className="mt-1 break-words">{statusMessage}</p>
                    {scanProgress ? (
                      <div className="mt-2 space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-cloud/15">
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

              <Separator className="w-1 bg-transparent transition-colors hover:bg-leaf/40" />

              <Panel id="main" minSize="30%" className="bg-surface-dark">
                <main className="flex h-full min-h-0 flex-col bg-surface-dark">
                  <header className="relative px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-1 pt-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
                                onClick={goBack}
                                disabled={pastStack.length === 0}
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Back (Cmd/Ctrl+[ or Alt+Left)</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
                                onClick={goForward}
                                disabled={futureStack.length === 0}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Forward (Cmd/Ctrl+] or Alt+Right)</TooltipContent>
                          </Tooltip>
                        </div>
                        <div>
                          <h2 className="text-base font-semibold tracking-tight text-cloud">
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
                          <p className="text-sm text-muted-on-dark">
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
                                        : activePlaylist?.is_folder
                                          ? `${activeFolderChildren.length.toLocaleString()} item(s)`
                                          : `${activePlaylistTrackCount.toLocaleString()} songs`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </header>

                  <section className="min-h-0 flex-1 px-4 pb-4 pt-2">
                    {activeView === "songs" ? (
                      <div className="flex h-full min-h-0 flex-col rounded-2xl bg-cloud/5">
                        <div className="grid grid-cols-[48px_2fr_1.6fr_1.6fr_120px_90px] gap-3 rounded-t-2xl bg-cloud/8 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
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

                        <div
                          ref={songsScrollRef}
                          className="min-h-0 flex-1 overflow-auto"
                          onScroll={(event) =>
                            recordScrollPositionForRoute(
                              { kind: "songs" },
                              event.currentTarget.scrollTop,
                            )
                          }
                        >
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
                                      "group/song grid h-full w-full select-none grid-cols-[48px_2fr_1.6fr_1.6fr_120px_90px] items-center gap-3 px-3 text-left text-sm text-cloud transition-colors",
                                      "hover:bg-cloud/8",
                                      isSelected && "bg-leaf/15",
                                      isActive && "border-l-2 border-l-blossom bg-blossom/20",
                                    )}
                                  >
                                    {song ? (
                                      <>
                                        <span className="text-muted-on-dark">
                                          {virtualRow.index + 1}
                                        </span>
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
                                                <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-on-dark" />
                                              ) : null}
                                            </div>
                                            {song.tags.length > 0 ? (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {song.tags.slice(0, 3).map((tag) => (
                                                  <span
                                                    key={tag.id}
                                                    className="rounded-full border border-cloud/20 px-1.5 py-0.5 text-[10px] leading-none text-cloud"
                                                    style={{ backgroundColor: `${tag.color}40` }}
                                                  >
                                                    {tag.name}
                                                  </span>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        <span className="truncate text-muted-on-dark">
                                          {song.artist}
                                        </span>
                                        <span className="truncate text-muted-on-dark">
                                          {song.album}
                                        </span>
                                        <span className="text-right text-muted-on-dark">
                                          {formatDuration(song.duration_ms)}
                                        </span>
                                        <span className="text-right text-muted-on-dark">
                                          {song.play_count}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-muted-on-dark">
                                          {virtualRow.index + 1}
                                        </span>
                                        <span className="col-span-5 text-muted-on-dark">
                                          Loading...
                                        </span>
                                      </>
                                    )}
                                  </DraggableSongButton>
                                </div>
                              );
                            })}

                            {songCount === 0 ? (
                              <p className="p-6 text-sm text-muted-on-dark">
                                No songs to display yet.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {activeView === "playlist" ? (
                      activePlaylist?.is_folder ? (
                        <div className="flex h-full min-h-0 flex-col rounded-2xl bg-cloud/5">
                          <div className="px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
                              Folder Contents
                            </p>
                          </div>
                          <div
                            ref={playlistFolderScrollRef}
                            className="min-h-0 flex-1 overflow-auto p-2"
                            onScroll={(event) => {
                              if (!activePlaylistId) {
                                return;
                              }
                              recordScrollPositionForRoute(
                                {
                                  kind: "playlist",
                                  playlistId: activePlaylistId,
                                },
                                event.currentTarget.scrollTop,
                              );
                            }}
                          >
                            {activeFolderChildren.length > 0 ? (
                              <div className="space-y-1">
                                {activeFolderChildren.map((child) => (
                                  <button
                                    key={child.id}
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/8"
                                    onClick={() =>
                                      navigateToRoute(
                                        {
                                          kind: "playlist",
                                          playlistId: child.id,
                                        },
                                        { playlistReorderMode: false },
                                      )
                                    }
                                  >
                                    {child.is_folder ? (
                                      <Folder className="h-4 w-4 shrink-0 text-muted-on-dark" />
                                    ) : (
                                      <ListMusic className="h-4 w-4 shrink-0 text-muted-on-dark" />
                                    )}
                                    <span className="truncate">{child.name}</span>
                                    <span className="ml-auto text-xs text-muted-on-dark">
                                      {child.is_folder ? "Folder" : "Playlist"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center rounded-2xl bg-cloud/5 text-sm text-muted-on-dark">
                                This folder is empty.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
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
                          initialScrollTop={
                            activePlaylistId
                              ? (scrollPositionsRef.current[
                                  navigationRouteKey({
                                    kind: "playlist",
                                    playlistId: activePlaylistId,
                                  })
                                ] ?? 0)
                              : 0
                          }
                          restoreScrollTop={playlistRestoreScrollTop}
                          onScrollTopChange={(scrollTop) => {
                            if (!activePlaylistId) {
                              return;
                            }
                            recordScrollPositionForRoute(
                              {
                                kind: "playlist",
                                playlistId: activePlaylistId,
                              },
                              scrollTop,
                            );
                          }}
                        />
                      )
                    ) : null}

                    {activeView === "albums" ? (
                      <div className="h-full rounded-2xl bg-cloud/5 p-4">
                        {selectedAlbum ? (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="mb-4 flex items-center">
                              <div>
                                <h3 className="text-lg font-semibold text-cloud">
                                  {selectedAlbum.album}
                                </h3>
                                <p className="text-sm text-muted-on-dark">
                                  {selectedAlbum.album_artist}
                                </p>
                              </div>
                            </div>

                            <div
                              ref={albumDetailScrollRef}
                              className="min-h-0 flex-1 overflow-auto rounded-2xl bg-cloud/5"
                              onScroll={(event) => {
                                if (!selectedAlbum) {
                                  return;
                                }
                                recordScrollPositionForRoute(
                                  {
                                    kind: "albums-detail",
                                    album: cloneAlbumIdentity(selectedAlbum),
                                  },
                                  event.currentTarget.scrollTop,
                                );
                              }}
                            >
                              {loadingAlbumTracks ? (
                                <p className="p-4 text-sm text-muted-on-dark">
                                  Loading album tracks...
                                </p>
                              ) : albumTracks.length === 0 ? (
                                <p className="p-4 text-sm text-muted-on-dark">
                                  No tracks found for this album.
                                </p>
                              ) : (
                                albumTracks.map((song, index) => (
                                  <button
                                    key={song.id}
                                    type="button"
                                    className={cn(
                                      "group/song grid w-full select-none grid-cols-[48px_2fr_1.6fr_120px] gap-3 px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/8",
                                      currentSong?.id === song.id &&
                                        "border-l-2 border-l-blossom bg-blossom/20",
                                    )}
                                    onDoubleClick={() => {
                                      setQueueSourceSongs(albumTracks);
                                      setQueueSourceLabel(selectedAlbum?.album ?? "Album");
                                      void replaceQueueAndPlay(albumTracks, index).catch(
                                        (error: unknown) => setErrorMessage(String(error)),
                                      );
                                    }}
                                  >
                                    <span className="text-muted-on-dark">{index + 1}</span>
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
                                    <span className="truncate text-muted-on-dark">
                                      {song.artist}
                                    </span>
                                    <span className="text-right text-muted-on-dark">
                                      {formatDuration(song.duration_ms)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            ref={albumsScrollRef}
                            className="h-full overflow-auto"
                            onScroll={(event) =>
                              recordScrollPositionForRoute(
                                { kind: "albums-list" },
                                event.currentTarget.scrollTop,
                              )
                            }
                          >
                            {isLoadingAlbums ? (
                              <p className="text-sm text-muted-on-dark">Loading albums...</p>
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
                                            className="rounded-2xl bg-cloud/8 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-cloud/12"
                                            onClick={() => {
                                              navigateToRoute({
                                                kind: "albums-detail",
                                                album: cloneAlbumIdentity(album),
                                              });
                                            }}
                                          >
                                            <SongArtwork
                                              artworkPath={album.artwork_path}
                                              className="mb-3"
                                              sizeClassName="h-32 w-full"
                                            />
                                            <p className="truncate font-medium text-cloud">
                                              {album.album}
                                            </p>
                                            <p className="truncate text-sm text-muted-on-dark">
                                              {album.album_artist}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-on-dark">
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
                      <div className="h-full rounded-2xl bg-cloud/5 p-4">
                        {!selectedArtist ? (
                          <div
                            ref={artistsScrollRef}
                            className="h-full overflow-auto rounded-2xl"
                            onScroll={(event) =>
                              recordScrollPositionForRoute(
                                { kind: "artists-list" },
                                event.currentTarget.scrollTop,
                              )
                            }
                          >
                            <div className="sticky top-0 z-10 grid grid-cols-[40px_2fr_100px_100px] items-center gap-3 bg-surface-dark/90 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-on-dark backdrop-blur-sm">
                              <span />
                              <span>Artist</span>
                              <span className="text-right">Albums</span>
                              <span className="text-right">Songs</span>
                            </div>
                            {isLoadingArtists ? (
                              <p className="p-4 text-sm text-muted-on-dark">Loading artists...</p>
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
                                        className="grid h-full w-full grid-cols-[40px_2fr_100px_100px] items-center gap-3 rounded-xl px-3 text-left text-sm text-cloud transition-colors hover:bg-cloud/8"
                                        onClick={() => {
                                          navigateToRoute({
                                            kind: "artists-detail",
                                            artist: artist.artist,
                                          });
                                        }}
                                      >
                                        {artist.artwork_path ? (
                                          <SongArtwork
                                            artworkPath={artist.artwork_path}
                                            sizeClassName="h-8 w-8"
                                          />
                                        ) : (
                                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cloud/10 text-sm font-semibold text-muted-on-dark">
                                            {artist.artist.charAt(0).toUpperCase()}
                                          </div>
                                        )}
                                        <span className="truncate font-medium">
                                          {artist.artist}
                                        </span>
                                        <span className="text-right text-muted-on-dark">
                                          {artist.album_count}
                                        </span>
                                        <span className="text-right text-muted-on-dark">
                                          {artist.song_count}
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
                            <div className="mb-5 flex items-center gap-4">
                              {artistAlbums.length > 0 && artistAlbums[0]?.artwork_path ? (
                                <SongArtwork
                                  artworkPath={artistAlbums[0].artwork_path}
                                  sizeClassName="h-20 w-20"
                                  className="shrink-0 rounded-2xl"
                                />
                              ) : (
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-cloud/10">
                                  <UserRound className="h-8 w-8 text-muted-on-dark" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <h3 className="truncate text-2xl font-bold tracking-tight text-cloud">
                                  {selectedArtist}
                                </h3>
                                <div className="mt-1 flex gap-3 text-sm text-muted-on-dark">
                                  <span>{artistAlbums.length} {artistAlbums.length === 1 ? "album" : "albums"}</span>
                                  <span className="text-cloud/20">|</span>
                                  <span>{artistAlbums.reduce((sum, a) => sum + a.song_count, 0)} songs</span>
                                  <span className="text-cloud/20">|</span>
                                  <span>{formatDuration(artistAlbums.reduce((sum, a) => sum + a.total_duration_ms, 0))}</span>
                                </div>
                              </div>
                            </div>

                            {!selectedArtistAlbum ? (
                              <div
                                ref={artistAlbumsScrollRef}
                                className="min-h-0 flex-1 overflow-auto rounded-2xl p-3"
                                onScroll={(event) => {
                                  if (!selectedArtist) {
                                    return;
                                  }
                                  recordScrollPositionForRoute(
                                    {
                                      kind: "artists-detail",
                                      artist: selectedArtist,
                                    },
                                    event.currentTarget.scrollTop,
                                  );
                                }}
                              >
                                {loadingArtistAlbums ? (
                                  <p className="text-sm text-muted-on-dark">Loading albums...</p>
                                ) : (
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                                    {artistAlbums.map((album) => (
                                      <button
                                        key={`${album.album}-${album.album_artist}`}
                                        type="button"
                                        className="rounded-2xl bg-cloud/8 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-cloud/12"
                                        onClick={() => {
                                          if (!selectedArtist) {
                                            return;
                                          }
                                          navigateToRoute({
                                            kind: "artists-album-detail",
                                            artist: selectedArtist,
                                            album: cloneAlbumIdentity(album),
                                          });
                                        }}
                                      >
                                        <SongArtwork
                                          artworkPath={album.artwork_path}
                                          className="mb-3"
                                          sizeClassName="h-32 w-full"
                                        />
                                        <p className="truncate font-medium text-cloud">
                                          {album.album}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-on-dark">
                                          {album.song_count} songs • {formatDuration(album.total_duration_ms)}
                                        </p>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div
                                ref={artistAlbumTracksScrollRef}
                                className="min-h-0 flex-1 overflow-auto rounded-2xl bg-cloud/5"
                                onScroll={(event) => {
                                  if (!selectedArtist || !selectedArtistAlbum) {
                                    return;
                                  }
                                  recordScrollPositionForRoute(
                                    {
                                      kind: "artists-album-detail",
                                      artist: selectedArtist,
                                      album: cloneAlbumIdentity(selectedArtistAlbum),
                                    },
                                    event.currentTarget.scrollTop,
                                  );
                                }}
                              >
                                <div className="flex items-center px-3 py-2">
                                  <div>
                                    <p className="font-medium text-cloud">
                                      {selectedArtistAlbum.album}
                                    </p>
                                    <p className="text-xs text-muted-on-dark">
                                      {selectedArtistAlbum.album_artist}
                                    </p>
                                  </div>
                                </div>

                                {loadingArtistAlbumTracks ? (
                                  <p className="p-4 text-sm text-muted-on-dark">
                                    Loading tracks...
                                  </p>
                                ) : (
                                  artistAlbumTracks.map((song, index) => (
                                    <button
                                      key={song.id}
                                      type="button"
                                      className={cn(
                                        "group/song grid w-full select-none grid-cols-[48px_2fr_120px] gap-3 px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/8",
                                        currentSong?.id === song.id &&
                                          "border-l-2 border-l-blossom bg-blossom/20",
                                      )}
                                      onDoubleClick={() => {
                                        setQueueSourceSongs(artistAlbumTracks);
                                        setQueueSourceLabel(selectedArtistAlbum?.album ?? "Artist");
                                        void replaceQueueAndPlay(artistAlbumTracks, index).catch(
                                          (error: unknown) => setErrorMessage(String(error)),
                                        );
                                      }}
                                    >
                                      <span className="text-muted-on-dark">{index + 1}</span>
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
                                      <span className="text-right text-muted-on-dark">
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
                      <div className="h-full rounded-2xl bg-cloud/5">
                        <HistoryView
                          initialScrollTop={
                            scrollPositionsRef.current[navigationRouteKey({ kind: "history" })] ?? 0
                          }
                          restoreScrollTop={historyRestoreScrollTop}
                          onScrollTopChange={(scrollTop) => {
                            recordScrollPositionForRoute({ kind: "history" }, scrollTop);
                          }}
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
                      <div className="h-full rounded-2xl bg-cloud/5 p-4">
                        <div
                          ref={statsScrollRef}
                          className="h-full overflow-auto"
                          onScroll={(event) =>
                            recordScrollPositionForRoute(
                              { kind: "stats" },
                              event.currentTarget.scrollTop,
                            )
                          }
                        >
                          <StatsView refreshSignal={statsRefreshSignal} />
                        </div>
                      </div>
                    ) : null}

                    {activeView === "settings" ? (
                      <div className="h-full rounded-2xl bg-cloud/5 p-4">
                        <div
                          ref={settingsScrollRef}
                          className="h-full overflow-auto"
                          onScroll={(event) =>
                            recordScrollPositionForRoute(
                              { kind: "settings" },
                              event.currentTarget.scrollTop,
                            )
                          }
                        >
                          <TagsSettingsPanel
                            tags={tags}
                            onCreateTag={handleCreateTag}
                            onRenameTag={handleRenameTag}
                            onSetTagColor={handleSetTagColor}
                            onDeleteTag={handleDeleteTag}
                          />

                          <div className="mt-8">
                            <h3 className="mb-3 text-sm font-semibold text-cloud">Export</h3>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
                                onClick={() => void handleExportPlayStatsCsv()}
                              >
                                <Download className="h-4 w-4" />
                                Play Stats CSV
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
                                onClick={() => void handleExportTagsCsv()}
                              >
                                <Download className="h-4 w-4" />
                                Tags CSV
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
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

          {songContextMenu ? (
            <div
              ref={contextMenuRef}
              className={`fixed z-50 rounded-2xl border border-border-dark bg-night p-1 shadow-xl transition-opacity duration-75 ${contextMenuPos ? "opacity-100" : "opacity-0"}`}
              style={contextMenuPos ?? { left: songContextMenu.x, top: songContextMenu.y }}
            >
              <button
                type="button"
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
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
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
                onClick={() => {
                  addSongsToQueue(songContextMenu.songIds);
                  setSongContextMenu(null);
                }}
              >
                Add to Queue
              </button>
              <button
                type="button"
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
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
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
                onClick={() => {
                  void openManageTagsForSongs(songContextMenu.songIds);
                  setSongContextMenu(null);
                }}
              >
                Manage Tags
              </button>
              <button
                type="button"
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
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
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
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
          <SearchPalette
            isOpen={isSearchPaletteOpen}
            selectedTagFilterIds={selectedTagFilterIds}
            localSongs={paletteLocalSongs}
            playlists={playlists}
            tags={tags}
            onOpenChange={setIsSearchPaletteOpen}
            onExecuteItem={(item, context) => handleExecuteSearchPaletteItem(item, context)}
            onError={(error) => setErrorMessage(String(error))}
          />
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
            <div className="rounded-2xl bg-cloud px-3 py-2 shadow-xl">
              <p className="text-sm font-medium">{dragOverlayLabel ?? "Dragging"}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </TooltipProvider>
  );
}

export default App;
