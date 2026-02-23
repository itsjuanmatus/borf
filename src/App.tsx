import { useVirtualizer } from "@tanstack/react-virtual";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Disc3,
  Library,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Repeat,
  Search,
  SkipBack,
  SkipForward,
  UserRound,
  Volume2,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Slider } from "./components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { audioApi, libraryApi } from "./lib/api";
import { cn } from "./lib/utils";
import { usePlayerStore } from "./stores/player-store";
import { useSessionStore } from "./stores/session-store";
import type {
  AlbumListItem,
  ArtistListItem,
  AudioErrorEvent,
  AudioPositionEvent,
  AudioStateEvent,
  AudioTrackEndedEvent,
  ItunesImportOptions,
  ItunesImportProgress,
  ItunesImportSummary,
  ItunesPreview,
  LibrarySearchResult,
  ScanProgressEvent,
  SongListItem,
  SongSortField,
  SortOrder,
} from "./types";

const SONG_PAGE_SIZE = 250;
const SONG_ROW_HEIGHT = 44;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_RESULT_LIMIT = 20;

type ImportWizardStep = 1 | 2 | 3 | 4 | 5;

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

  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);

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

  const [songContextMenu, setSongContextMenu] = useState<{
    x: number;
    y: number;
    songId: string;
    index: number;
  } | null>(null);

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

  const sidebarSize = useSessionStore((state) => state.sidebarSize);
  const setSidebarSize = useSessionStore((state) => state.setSidebarSize);
  const persistedVolume = useSessionStore((state) => state.volume);
  const setPersistedVolume = useSessionStore((state) => state.setVolume);

  const activeView = useSessionStore((state) => state.activeView);
  const setActiveView = useSessionStore((state) => state.setActiveView);

  const queueSongIds = useSessionStore((state) => state.queueSongIds);
  const queueCurrentIndex = useSessionStore((state) => state.queueCurrentIndex);
  const setQueueState = useSessionStore((state) => state.setQueueState);
  const repeatAll = useSessionStore((state) => state.repeatAll);
  const setRepeatAll = useSessionStore((state) => state.setRepeatAll);

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
  const playbackState = usePlayerStore((state) => state.playbackState);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);

  const setSongs = usePlayerStore((state) => state.setSongs);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlaying = usePlayerStore((state) => state.setNowPlaying);
  const setCurrentIndex = usePlayerStore((state) => state.setCurrentIndex);
  const setPlaybackState = usePlayerStore((state) => state.setPlaybackState);
  const setPosition = usePlayerStore((state) => state.setPosition);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const songsScrollRef = useRef<HTMLDivElement | null>(null);
  const albumsScrollRef = useRef<HTMLDivElement | null>(null);
  const artistsScrollRef = useRef<HTMLDivElement | null>(null);

  const [albumGridWidth, setAlbumGridWidth] = useState(920);

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

  const resetSongPages = useCallback(() => {
    loadedSongPagesRef.current.clear();
    loadingSongPagesRef.current.clear();
    setSongsByIndex({});
  }, []);

  const persistQueue = useCallback(
    (nextQueue: SongListItem[], nextIndex: number | null) => {
      setQueueState({
        songIds: nextQueue.map((song) => song.id),
        currentIndex: nextIndex,
        repeatAll,
      });
    },
    [repeatAll, setQueueState],
  );

  const refreshSongCount = useCallback(async () => {
    const count = await libraryApi.getSongCount();
    setSongCount(count);

    if (count === 0) {
      setStatusMessage("No songs found yet. Scan a folder to begin.");
      setSongs([]);
      setQueue([], null);
      setNowPlaying(null);
      setCurrentIndex(null);
      setPlaybackState("stopped");
      setPosition(0, 0);
      persistQueue([], null);
    } else {
      setStatusMessage(`Loaded ${count.toLocaleString()} song(s).`);
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
        });

        setSongsByIndex((previous) => {
          const next = { ...previous };
          for (let index = 0; index < chunk.length; index += 1) {
            next[offset + index] = chunk[index];
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
    [setSongs, songOrder, songSort],
  );

  const loadAllSongsForCurrentSort = useCallback(async () => {
    const total = await libraryApi.getSongCount();
    const result: SongListItem[] = [];
    let offset = 0;

    while (offset < total) {
      const chunk = await libraryApi.getSongs({
        limit: SONG_PAGE_SIZE,
        offset,
        sort: songSort,
        order: songOrder,
      });
      if (chunk.length === 0) {
        break;
      }
      result.push(...chunk);
      offset += chunk.length;
    }

    return result;
  }, [songOrder, songSort]);

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

      await audioApi.play(song.id, startMs);
      setErrorMessage(null);
    },
    [persistQueue, setCurrentIndex, setNowPlaying, setPlaybackState, setPosition, setQueue],
  );

  const playQueueIndex = useCallback(
    async (index: number, startMs?: number) => {
      if (index < 0 || index >= queue.length) {
        return;
      }

      const song = queue[index];
      await audioApi.play(song.id, startMs);
      setCurrentIndex(index);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      persistQueue(queue, index);
      setErrorMessage(null);
    },
    [persistQueue, queue, setCurrentIndex, setNowPlaying, setPlaybackState, setPosition],
  );

  const playNext = useCallback(() => {
    if (queue.length === 0) {
      return;
    }

    if (currentIndex === null) {
      void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
      return;
    }

    if (currentIndex >= queue.length - 1) {
      if (repeatAll) {
        void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
      } else {
        setPlaybackState("stopped");
      }
      return;
    }

    void playQueueIndex(currentIndex + 1).catch((error: unknown) => setErrorMessage(String(error)));
  }, [currentIndex, playQueueIndex, queue.length, repeatAll, setPlaybackState]);

  const playPrevious = useCallback(() => {
    if (queue.length === 0) {
      return;
    }

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
      if (repeatAll) {
        void playQueueIndex(queue.length - 1).catch((error: unknown) =>
          setErrorMessage(String(error)),
        );
      } else {
        void playQueueIndex(0).catch((error: unknown) => setErrorMessage(String(error)));
      }
      return;
    }

    void playQueueIndex(currentIndex - 1).catch((error: unknown) => setErrorMessage(String(error)));
  }, [currentIndex, durationMs, playQueueIndex, positionMs, queue.length, repeatAll, setPosition]);

  const handleTogglePlayback = useCallback(async () => {
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
        await replaceQueueAndPlay(allSongs, 0);
      }
    }
  }, [
    currentIndex,
    loadAllSongsForCurrentSort,
    playQueueIndex,
    playbackState,
    queue.length,
    replaceQueueAndPlay,
    setPlaybackState,
    songCount,
  ]);

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

  const refreshAllViews = useCallback(async () => {
    resetSongPages();
    await refreshSongCount();
    await ensureSongPage(0);
    await Promise.all([refreshAlbums(), refreshArtists()]);
  }, [ensureSongPage, refreshAlbums, refreshArtists, refreshSongCount, resetSongPages]);

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

      await replaceQueueAndPlay(allSongs, startIndex);
    },
    [loadAllSongsForCurrentSort, replaceQueueAndPlay, songsByIndex],
  );

  const currentSong = useMemo(
    () => nowPlaying ?? (currentIndex !== null ? (queue[currentIndex] ?? null) : null),
    [currentIndex, nowPlaying, queue],
  );

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
      .search(debouncedSearchQuery, SEARCH_RESULT_LIMIT)
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
  }, [debouncedSearchQuery]);

  useEffect(() => {
    void audioApi.setVolume(persistedVolume).catch(() => {
      // Ignore initial volume sync errors.
    });
  }, [persistedVolume]);

  useEffect(() => {
    void refreshSongCount()
      .then(() => ensureSongPage(0))
      .catch((error: unknown) => setErrorMessage(String(error)));
  }, [ensureSongPage, refreshSongCount]);

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
      })
      .catch((error: unknown) => setErrorMessage(String(error)));
  }, [queueCurrentIndex, queueSongIds, setCurrentIndex, setNowPlaying, setQueue]);

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
      }),
      listen<AudioPositionEvent>("audio:position-update", (event) => {
        setPosition(event.payload.current_ms, event.payload.duration_ms);
      }),
      listen<AudioTrackEndedEvent>("audio:track-ended", () => {
        playNext();
      }),
      listen<AudioErrorEvent>("audio:error", (event) => {
        setErrorMessage(event.payload.message);
      }),
      listen<ItunesImportProgress>("import:itunes-progress", (event) => {
        setItunesProgress(event.payload);
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => {
        for (const callback of callbacks) {
          callback();
        }
      });
    };
  }, [playNext, setPlaybackState, setPosition]);

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
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
              <aside className="h-full border-r border-border/80 bg-surface/85 p-4 backdrop-blur-sm">
                <div className="mb-6 flex items-center gap-2">
                  <div className="rounded-full bg-sky p-2 text-night">
                    <Waves className="h-4 w-4" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight">borf</h1>
                    <p className="text-xs text-muted">Phase 2 + iTunes import</p>
                  </div>
                </div>

                <div className="mt-6 space-y-2 rounded-xl border border-border bg-white/80 p-3 text-sm">
                  <p className="font-medium">Library</p>

                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors",
                      activeView === "songs" ? "bg-sky/30 text-text" : "text-muted hover:bg-sky/10",
                    )}
                    onClick={() => {
                      setActiveView("songs");
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
                      setActiveView("albums");
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
                      setActiveView("artists");
                      setSelectedAlbum(null);
                    }}
                  >
                    <UserRound className="h-4 w-4" />
                    Artists
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-white/80 p-3 text-xs text-muted">
                  <p className="font-medium text-text">Status</p>
                  {isScanning ? <p className="mt-1 text-accent">Scanning in progress...</p> : null}
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
                            : "Artists"}
                      </h2>
                      <p className="text-sm text-muted">
                        {activeView === "songs"
                          ? `${songCount.toLocaleString()} songs`
                          : activeView === "albums"
                            ? `${albums.length.toLocaleString()} albums`
                            : `${artists.length.toLocaleString()} artists`}
                      </p>
                    </div>

                    <div className="w-full max-w-xl">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <Input
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search songs, albums, artists (Cmd+K)"
                          className="pl-10"
                        />
                      </div>
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
                                <button
                                  key={song.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-sky/10"
                                  onClick={() => {
                                    void replaceQueueAndPlay(searchResults.songs, index).catch(
                                      (error: unknown) => setErrorMessage(String(error)),
                                    );
                                    setSearchQuery("");
                                  }}
                                >
                                  <span className="truncate">
                                    {song.title} <span className="text-muted">• {song.artist}</span>
                                  </span>
                                  <span className="text-xs text-muted">
                                    {formatDuration(song.duration_ms)}
                                  </span>
                                </button>
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
                                    setActiveView("albums");
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
                                    setActiveView("artists");
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
                          Plays {songSort === "play_count" ? (songOrder === "asc" ? "↑" : "↓") : ""}
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
                            const isSelected = selectedSongId === song?.id;
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
                                <button
                                  type="button"
                                  onClick={() => setSelectedSongId(song?.id ?? null)}
                                  onDoubleClick={() => {
                                    void playFromSongsIndex(virtualRow.index).catch(
                                      (error: unknown) => setErrorMessage(String(error)),
                                    );
                                  }}
                                  onContextMenu={(event) => {
                                    if (!song) {
                                      return;
                                    }
                                    event.preventDefault();
                                    setSongContextMenu({
                                      x: event.clientX,
                                      y: event.clientY,
                                      songId: song.id,
                                      index: virtualRow.index,
                                    });
                                  }}
                                  className={cn(
                                    "grid h-full w-full grid-cols-[48px_2fr_1.6fr_1.6fr_120px_90px] items-center gap-3 border-b border-border/60 px-3 text-left text-sm transition-colors",
                                    "hover:bg-sky/15",
                                    isSelected && "bg-sky/20",
                                    isActive && "bg-blossom/25",
                                  )}
                                >
                                  {song ? (
                                    <>
                                      <span className="text-muted">{virtualRow.index + 1}</span>
                                      <span className="truncate font-medium">{song.title}</span>
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
                                </button>
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
                                    "grid w-full grid-cols-[48px_2fr_1.6fr_120px] gap-3 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-sky/15",
                                    currentSong?.id === song.id && "bg-blossom/25",
                                  )}
                                  onDoubleClick={() => {
                                    void replaceQueueAndPlay(albumTracks, index).catch(
                                      (error: unknown) => setErrorMessage(String(error)),
                                    );
                                  }}
                                >
                                  <span className="text-muted">{index + 1}</span>
                                  <span className="truncate font-medium">{song.title}</span>
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
                                      <span className="truncate font-medium">{artist.artist}</span>
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
                                      <p className="text-sm text-muted">{album.song_count} songs</p>
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
                                      "grid w-full grid-cols-[48px_2fr_120px] gap-3 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-sky/15",
                                      currentSong?.id === song.id && "bg-blossom/25",
                                    )}
                                    onDoubleClick={() => {
                                      void replaceQueueAndPlay(artistAlbumTracks, index).catch(
                                        (error: unknown) => setErrorMessage(String(error)),
                                      );
                                    }}
                                  >
                                    <span className="text-muted">{index + 1}</span>
                                    <span className="truncate font-medium">{song.title}</span>
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
                </section>
              </main>
            </Panel>
          </Group>
        </div>

        <footer className="border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm">
          <div className="grid grid-cols-3 items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky/40">
                <Music2 className="h-6 w-6 text-night/70" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {currentSong?.title ?? "Nothing playing"}
                </p>
                <p className="truncate text-xs text-muted">
                  {currentSong
                    ? `${currentSong.artist} • ${currentSong.album}`
                    : "Double-click a song to start playback"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={playPrevious}
                      disabled={queue.length === 0}
                    >
                      <SkipBack className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Previous</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      onClick={() =>
                        void handleTogglePlayback().catch((error: unknown) =>
                          setErrorMessage(String(error)),
                        )
                      }
                      disabled={queue.length === 0 && songCount === 0}
                    >
                      {playbackState === "playing" ? (
                        <Pause className="h-5 w-5" />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{playbackState === "playing" ? "Pause" : "Play"}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={playNext}
                      disabled={queue.length === 0}
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Next</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={repeatAll ? "default" : "secondary"}
                      onClick={() => setRepeatAll(!repeatAll)}
                    >
                      <Repeat className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {repeatAll ? "Repeat All: On" : "Repeat All: Off"}
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="w-10 text-right">{formatDuration(positionMs)}</span>
                <Slider
                  value={[Math.min(positionMs, durationMs || positionMs)]}
                  max={Math.max(durationMs, 1)}
                  step={250}
                  onValueCommit={(value) => {
                    const nextPosition = value[0] ?? 0;
                    setPosition(nextPosition, durationMs);
                    void audioApi
                      .seek(nextPosition)
                      .catch((error: unknown) => setErrorMessage(String(error)));
                  }}
                />
                <span className="w-10">{formatDuration(durationMs)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs text-muted">
              <p className="mr-2">Queue: {queue.length}</p>
              <Volume2 className="h-4 w-4" />
              <div className="w-28">
                <Slider
                  value={[persistedVolume * 100]}
                  max={100}
                  step={1}
                  onValueChange={(value) => {
                    const nextVolume = (value[0] ?? 0) / 100;
                    setPersistedVolume(nextVolume);
                    void audioApi
                      .setVolume(nextVolume)
                      .catch((error: unknown) => setErrorMessage(String(error)));
                  }}
                />
              </div>
            </div>
          </div>
        </footer>

        {songContextMenu ? (
          <div
            className="fixed z-50 rounded-lg border border-border bg-white p-1 shadow-lg"
            style={{ left: songContextMenu.x, top: songContextMenu.y }}
          >
            <button
              type="button"
              className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sky/10"
              onClick={() => {
                void playFromSongsIndex(songContextMenu.index).catch((error: unknown) =>
                  setErrorMessage(String(error)),
                );
                setSongContextMenu(null);
              }}
            >
              Play from here
            </button>
          </div>
        ) : null}

        {showImportWizard ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-border bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Import iTunes Library</h3>
                  <p className="text-sm text-muted">Step {importWizardStep} of 5</p>
                </div>
                <Button variant="secondary" onClick={resetImportWizard}>
                  Close
                </Button>
              </div>

              {importWizardStep === 1 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Select your iTunes <code>Library.xml</code> file to start.
                  </p>
                  <Button onClick={() => void handlePickItunesXml()}>Select Library.xml</Button>
                  {itunesXmlPath ? <p className="text-xs text-muted">{itunesXmlPath}</p> : null}
                </div>
              ) : null}

              {importWizardStep === 2 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted">Preview detected content before importing.</p>
                  {itunesPreview ? (
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
                      <p>Tracks found: {itunesPreview.tracks_found.toLocaleString()}</p>
                      <p>Playlists found: {itunesPreview.playlists_found.toLocaleString()}</p>
                      <p>Matched tracks: {itunesPreview.matched_tracks.toLocaleString()}</p>
                      <p>Unmatched tracks: {itunesPreview.unmatched_tracks.toLocaleString()}</p>
                      <p>Smart playlists skipped: {itunesPreview.skipped_smart_playlists}</p>
                      <p>System playlists skipped: {itunesPreview.skipped_system_playlists}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Loading preview...</p>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setImportWizardStep(1)}>
                      Back
                    </Button>
                    <Button onClick={() => setImportWizardStep(3)} disabled={!itunesPreview}>
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}

              {importWizardStep === 3 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted">Choose what to import from iTunes.</p>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itunesOptions.import_play_counts}
                      onChange={(event) =>
                        setItunesOptions((previous) => ({
                          ...previous,
                          import_play_counts: event.target.checked,
                        }))
                      }
                    />
                    Play counts and skip counts
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itunesOptions.import_ratings}
                      onChange={(event) =>
                        setItunesOptions((previous) => ({
                          ...previous,
                          import_ratings: event.target.checked,
                        }))
                      }
                    />
                    Ratings
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itunesOptions.import_comments}
                      onChange={(event) =>
                        setItunesOptions((previous) => ({
                          ...previous,
                          import_comments: event.target.checked,
                        }))
                      }
                    />
                    Comments
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itunesOptions.import_playlists}
                      onChange={(event) =>
                        setItunesOptions((previous) => ({
                          ...previous,
                          import_playlists: event.target.checked,
                        }))
                      }
                    />
                    Playlists
                  </label>

                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setImportWizardStep(2)}>
                      Back
                    </Button>
                    <Button onClick={() => void handleRunItunesImport()}>Run Import</Button>
                  </div>
                </div>
              ) : null}

              {importWizardStep === 4 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Import in progress...
                  </div>

                  {itunesProgress ? (
                    <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-sm">
                      <p className="font-medium">Stage: {itunesProgress.stage}</p>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-sky/30">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-200"
                          style={{ width: `${importProgressPercent}%` }}
                        />
                      </div>
                      <p>
                        {itunesProgress.processed.toLocaleString()} /{" "}
                        {itunesProgress.total.toLocaleString()}
                      </p>
                      <p>
                        Matched: {itunesProgress.matched.toLocaleString()} • Unmatched:{" "}
                        {itunesProgress.unmatched.toLocaleString()}
                      </p>
                      {itunesProgress.current_item ? (
                        <p className="truncate text-xs text-muted">{itunesProgress.current_item}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {!isImporting ? (
                    <div className="flex justify-end">
                      <Button onClick={() => setImportWizardStep(5)}>Continue</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {importWizardStep === 5 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Import complete
                  </div>

                  {itunesSummary ? (
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
                      <p>Tracks found: {itunesSummary.tracks_found.toLocaleString()}</p>
                      <p>Matched tracks: {itunesSummary.matched_tracks.toLocaleString()}</p>
                      <p>Unmatched tracks: {itunesSummary.unmatched_tracks.toLocaleString()}</p>
                      <p>
                        Song updates imported:{" "}
                        {itunesSummary.imported_song_updates.toLocaleString()}
                      </p>
                      <p>Playlists imported: {itunesSummary.imported_playlists.toLocaleString()}</p>
                      <p>Playlists scanned: {itunesSummary.playlists_found.toLocaleString()}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No summary data available.</p>
                  )}

                  <div className="flex justify-end">
                    <Button onClick={resetImportWizard}>Done</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

export default App;
