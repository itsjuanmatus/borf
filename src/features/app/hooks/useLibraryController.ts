import { useVirtualizer } from "@tanstack/react-virtual";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { libraryApi, tagsApi } from "../../../lib/api";
import {
  DEFAULT_SONG_COLUMN_ORDER,
  DEFAULT_VISIBLE_SONG_COLUMNS,
  normalizeSongColumnOrder,
  normalizeSongVisibleColumns,
  SONG_OPTIONAL_COLUMN_CONFIG,
  SONG_OPTIONAL_COLUMN_ORDER,
} from "../../../lib/song-columns";
import { usePlayerStore } from "../../../stores/player-store";
import { useSessionStore } from "../../../stores/session-store";
import type {
  AlbumListItem,
  ArtistListItem,
  LibrarySearchResult,
  LibraryView,
  SongListItem,
  SongOptionalColumnKey,
  SongSortField,
  SortOrder,
  Tag,
} from "../../../types";
import type { AlbumIdentity } from "../navigation/navigation-types";

const SONG_PAGE_SIZE = 250;
const SONG_IDS_BATCH_SIZE = 400;
const SONG_ROW_HEIGHT = 54;
const SEARCH_DEBOUNCE_MS = 40;
const SEARCH_MIN_TEXT_LENGTH = 1;
const SEARCH_RESULT_LIMIT = 20;
const PALETTE_CATALOG_PAGE_SIZE = 1000;

interface UseLibraryControllerParams {
  activeView: LibraryView;
  songsScrollRef: MutableRefObject<HTMLDivElement | null>;
  albumsScrollRef: MutableRefObject<HTMLDivElement | null>;
  artistsScrollRef: MutableRefObject<HTMLDivElement | null>;
  persistQueue: (ids: string[], nextIndex: number | null) => void;
  setStatusMessage: (message: string) => void;
  setErrorMessage: (message: string | null) => void;
}

type StartupTokenChecker = (token: number) => boolean;
interface StartupTaskOptions {
  token?: number;
  isCurrent?: StartupTokenChecker;
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

function nextSort(currentField: SongSortField, currentOrder: SortOrder, field: SongSortField) {
  if (currentField === field) {
    return currentOrder === "asc" ? "desc" : "asc";
  }
  return "asc";
}

function isStartupTaskCurrent(options?: StartupTaskOptions) {
  if (options?.token === undefined || !options.isCurrent) {
    return true;
  }
  return options.isCurrent(options.token);
}

export function useLibraryController({
  activeView,
  songsScrollRef,
  albumsScrollRef,
  artistsScrollRef,
  persistQueue,
  setStatusMessage,
  setErrorMessage,
}: UseLibraryControllerParams) {
  const [songCount, setSongCount] = useState(0);
  const [songsByIndex, setSongsByIndex] = useState<Record<number, SongListItem>>({});
  const [songsOrderedIds, setSongsOrderedIds] = useState<string[]>([]);

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

  const [albumGridWidth, setAlbumGridWidth] = useState(920);

  const songSort = useSessionStore((state) => state.songSort);
  const songOrder = useSessionStore((state) => state.songOrder);
  const setSongSort = useSessionStore((state) => state.setSongSort);
  const songColumnOrder = useSessionStore((state) => state.songColumnOrder);
  const setSongColumnOrder = useSessionStore((state) => state.setSongColumnOrder);
  const songVisibleColumns = useSessionStore((state) => state.songVisibleColumns);
  const setSongVisibleColumns = useSessionStore((state) => state.setSongVisibleColumns);

  const albumSort = useSessionStore((state) => state.albumSort);
  const albumOrder = useSessionStore((state) => state.albumOrder);
  const artistSort = useSessionStore((state) => state.artistSort);
  const artistOrder = useSessionStore((state) => state.artistOrder);

  const setSongs = usePlayerStore((state) => state.setSongs);
  const setQueueIds = usePlayerStore((state) => state.setQueueIds);
  const setNowPlaying = usePlayerStore((state) => state.setNowPlaying);
  const setCurrentIndex = usePlayerStore((state) => state.setCurrentIndex);
  const setPlaybackState = usePlayerStore((state) => state.setPlaybackState);
  const setPosition = usePlayerStore((state) => state.setPosition);

  const loadedSongPagesRef = useRef<Set<number>>(new Set());
  const loadingSongPagesRef = useRef<Set<number>>(new Set());
  const latestSearchTokenRef = useRef(0);
  const paletteCatalogTokenRef = useRef(0);

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

  const normalizedSongColumnOrder = useMemo(
    () => normalizeSongColumnOrder(songColumnOrder),
    [songColumnOrder],
  );
  const normalizedVisibleSongColumns = useMemo(
    () => normalizeSongVisibleColumns(songVisibleColumns),
    [songVisibleColumns],
  );
  const visibleSongColumnSet = useMemo(
    () => new Set(normalizedVisibleSongColumns),
    [normalizedVisibleSongColumns],
  );
  const visibleSongColumns = useMemo(
    () => normalizedSongColumnOrder.filter((columnKey) => visibleSongColumnSet.has(columnKey)),
    [normalizedSongColumnOrder, visibleSongColumnSet],
  );
  const visibleSongColumnConfigs = useMemo(
    () =>
      visibleSongColumns.map((columnKey) => ({
        key: columnKey,
        config: SONG_OPTIONAL_COLUMN_CONFIG[columnKey],
      })),
    [visibleSongColumns],
  );
  const songGridTemplateColumns = useMemo(
    () =>
      ["48px", "2fr", ...visibleSongColumnConfigs.map((column) => column.config.width)].join(" "),
    [visibleSongColumnConfigs],
  );
  const songLoadingColumnSpan = visibleSongColumns.length + 1;
  const compactSongGridTemplateColumnsWithAction = useMemo(
    () =>
      [
        "32px",
        "2fr",
        ...visibleSongColumnConfigs.map((column) => column.config.width),
        "46px",
      ].join(" "),
    [visibleSongColumnConfigs],
  );

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
  const albumVirtualRows = albumsVirtualizer.getVirtualItems();
  const artistVirtualRows = artistsVirtualizer.getVirtualItems();

  const resetSongPages = useCallback(() => {
    loadedSongPagesRef.current.clear();
    loadingSongPagesRef.current.clear();
    setSongsByIndex({});
    setSongsOrderedIds([]);
  }, []);

  const refreshSongCount = useCallback(
    async (options?: StartupTaskOptions) => {
      const count = await libraryApi.getSongCount(selectedTagFilterIds);
      if (!isStartupTaskCurrent(options)) {
        return count;
      }
      const totalSongCount =
        selectedTagFilterIds.length > 0 ? await libraryApi.getSongCount() : count;
      if (!isStartupTaskCurrent(options)) {
        return count;
      }
      setSongCount(count);

      if (count === 0 && totalSongCount === 0) {
        setStatusMessage("No songs found yet. Scan a folder to begin.");
        setSongs([]);
        setQueueIds([], null);
        setNowPlaying(null);
        setCurrentIndex(null);
        setPlaybackState("stopped");
        setPosition(0, 0);
        persistQueue([], null);
      } else if (count === 0 && selectedTagFilterIds.length > 0) {
        setStatusMessage("No songs match the current tag filters.");
      } else if (selectedTagFilterIds.length > 0) {
        setStatusMessage(
          `Loaded ${count.toLocaleString()} song(s) matching ${selectedTagFilterIds.length} tag filter(s).`,
        );
      } else {
        setStatusMessage(`Loaded ${count.toLocaleString()} song(s).`);
      }

      return count;
    },
    [
      persistQueue,
      selectedTagFilterIds,
      setCurrentIndex,
      setNowPlaying,
      setPlaybackState,
      setPosition,
      setQueueIds,
      setSongs,
      setStatusMessage,
    ],
  );

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
    async (page: number, options?: StartupTaskOptions) => {
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
        if (!isStartupTaskCurrent(options)) {
          return;
        }

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

  const loadSortedSongIds = useCallback(async () => {
    return libraryApi.getSortedSongIds({
      sort: songSort,
      order: songOrder,
      tagIds: selectedTagFilterIds,
    });
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

  const refreshAlbums = useCallback(
    async (options?: StartupTaskOptions) => {
      setIsLoadingAlbums(true);
      try {
        const result = await libraryApi.getAlbums({
          limit: 5000,
          offset: 0,
          sort: albumSort,
          order: albumOrder,
        });
        if (!isStartupTaskCurrent(options)) {
          return;
        }
        setAlbums(result);
      } finally {
        setIsLoadingAlbums(false);
      }
    },
    [albumOrder, albumSort],
  );

  const refreshArtists = useCallback(
    async (options?: StartupTaskOptions) => {
      setIsLoadingArtists(true);
      try {
        const result = await libraryApi.getArtists({
          limit: 5000,
          offset: 0,
          sort: artistSort,
          order: artistOrder,
        });
        if (!isStartupTaskCurrent(options)) {
          return;
        }
        setArtists(result);
      } finally {
        setIsLoadingArtists(false);
      }
    },
    [artistOrder, artistSort],
  );

  const refreshTags = useCallback(async (options?: StartupTaskOptions) => {
    const result = await tagsApi.list();
    if (!isStartupTaskCurrent(options)) {
      return;
    }
    setTags(result);
  }, []);

  const bootstrapSongs = useCallback(
    async (token: number, isCurrent: StartupTokenChecker) => {
      resetSongPages();
      await refreshSongCount({ token, isCurrent });
      if (!isCurrent(token)) {
        return;
      }
      await ensureSongPage(0, { token, isCurrent });
    },
    [ensureSongPage, refreshSongCount, resetSongPages],
  );

  const bootstrapAlbums = useCallback(
    async (token: number, isCurrent: StartupTokenChecker) => {
      await refreshAlbums({ token, isCurrent });
    },
    [refreshAlbums],
  );

  const bootstrapArtists = useCallback(
    async (token: number, isCurrent: StartupTokenChecker) => {
      await refreshArtists({ token, isCurrent });
    },
    [refreshArtists],
  );

  const bootstrapTags = useCallback(
    async (token: number, isCurrent: StartupTokenChecker) => {
      await refreshTags({ token, isCurrent });
    },
    [refreshTags],
  );

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

  const handleCreateTag = useCallback(
    async (name: string, color: string) => {
      try {
        await tagsApi.create(name, color);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags, setErrorMessage],
  );

  const handleRenameTag = useCallback(
    async (tag: Tag, nextName: string) => {
      try {
        await tagsApi.rename(tag.id, nextName);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags, setErrorMessage],
  );

  const handleSetTagColor = useCallback(
    async (tag: Tag, nextColor: string) => {
      try {
        await tagsApi.setColor(tag.id, nextColor);
        await refreshTags();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [refreshTags, setErrorMessage],
  );

  const handleDeleteTag = useCallback(
    async (tag: Tag) => {
      try {
        await tagsApi.delete(tag.id);
        setSelectedTagFilterIds((previous) => previous.filter((value) => value !== tag.id));
        await refreshTags();
        await refreshSongCount().then(() => ensureSongPage(0));
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [ensureSongPage, refreshSongCount, refreshTags, setErrorMessage],
  );

  const applySongVisibleColumns = useCallback(
    (nextColumns: SongOptionalColumnKey[]) => {
      const normalized = normalizeSongVisibleColumns(nextColumns);
      setSongVisibleColumns(normalized);

      const sortedColumnKey = SONG_OPTIONAL_COLUMN_ORDER.find(
        (columnKey) => SONG_OPTIONAL_COLUMN_CONFIG[columnKey].sortField === songSort,
      );
      if (!sortedColumnKey || normalized.includes(sortedColumnKey)) {
        return;
      }

      setSongSort("title", "asc");
      resetSongPages();
      void refreshSongCount()
        .then(() => ensureSongPage(0))
        .catch((error: unknown) => setErrorMessage(String(error)));
    },
    [
      ensureSongPage,
      refreshSongCount,
      resetSongPages,
      setErrorMessage,
      setSongSort,
      setSongVisibleColumns,
      songSort,
    ],
  );

  const applySongColumnOrder = useCallback(
    (nextOrder: SongOptionalColumnKey[]) => {
      setSongColumnOrder(normalizeSongColumnOrder(nextOrder));
    },
    [setSongColumnOrder],
  );

  const handleToggleSongColumn = useCallback(
    (column: SongOptionalColumnKey) => {
      if (visibleSongColumns.includes(column)) {
        applySongVisibleColumns(visibleSongColumns.filter((value) => value !== column));
        return;
      }
      applySongVisibleColumns([...visibleSongColumns, column]);
    },
    [applySongVisibleColumns, visibleSongColumns],
  );

  const handleMoveSongColumn = useCallback(
    (column: SongOptionalColumnKey, direction: "up" | "down") => {
      const currentIndex = normalizedSongColumnOrder.indexOf(column);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= normalizedSongColumnOrder.length) {
        return;
      }

      const nextOrder = [...normalizedSongColumnOrder];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [
        nextOrder[nextIndex],
        nextOrder[currentIndex],
      ];
      applySongColumnOrder(nextOrder);
    },
    [applySongColumnOrder, normalizedSongColumnOrder],
  );

  const handleResetSongColumns = useCallback(() => {
    applySongColumnOrder(DEFAULT_SONG_COLUMN_ORDER);
    applySongVisibleColumns(DEFAULT_VISIBLE_SONG_COLUMNS);
  }, [applySongColumnOrder, applySongVisibleColumns]);

  const handleSongSortClick = useCallback(
    (field: SongSortField) => {
      const order = nextSort(songSort, songOrder, field);
      setSongSort(field, order);
      resetSongPages();
      void refreshSongCount()
        .then(() => ensureSongPage(0))
        .catch((error: unknown) => setErrorMessage(String(error)));
    },
    [
      ensureSongPage,
      refreshSongCount,
      resetSongPages,
      setErrorMessage,
      setSongSort,
      songOrder,
      songSort,
    ],
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
  }, [canRunDebouncedSearch, debouncedSearchQuery, selectedTagFilterIds, setErrorMessage]);

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
  }, [
    isSearchPaletteOpen,
    paletteCatalogSongs.length,
    refreshPaletteCatalogSongs,
    setErrorMessage,
  ]);

  useEffect(() => {
    if (activeView === "albums") {
      void refreshAlbums().catch((error: unknown) => setErrorMessage(String(error)));
    }
  }, [activeView, refreshAlbums, setErrorMessage]);

  useEffect(() => {
    if (activeView === "artists") {
      void refreshArtists().catch((error: unknown) => setErrorMessage(String(error)));
    }
  }, [activeView, refreshArtists, setErrorMessage]);

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
  }, [albumsScrollRef]);

  return {
    songCount,
    songsByIndex,
    songsOrderedIds,
    albums,
    artists,
    isLoadingAlbums,
    isLoadingArtists,
    selectedAlbum,
    setSelectedAlbum,
    albumTracks,
    setAlbumTracks,
    loadingAlbumTracks,
    selectedArtist,
    setSelectedArtist,
    artistAlbums,
    setArtistAlbums,
    selectedArtistAlbum,
    setSelectedArtistAlbum,
    artistAlbumTracks,
    setArtistAlbumTracks,
    loadingArtistAlbums,
    loadingArtistAlbumTracks,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearchPaletteOpen,
    setIsSearchPaletteOpen,
    paletteCatalogSongs,
    tags,
    selectedTagFilterIds,
    setSelectedTagFilterIds,
    songSort,
    songOrder,
    normalizedSongColumnOrder,
    visibleSongColumns,
    visibleSongColumnConfigs,
    songGridTemplateColumns,
    songLoadingColumnSpan,
    compactSongGridTemplateColumnsWithAction,
    songVirtualRows,
    songVirtualTotalSize: songVirtualizer.getTotalSize(),
    albumColumns,
    albumVirtualRows,
    albumVirtualTotalSize: albumsVirtualizer.getTotalSize(),
    artistVirtualRows,
    artistVirtualTotalSize: artistsVirtualizer.getTotalSize(),
    resetSongPages,
    bootstrapSongs,
    bootstrapAlbums,
    bootstrapArtists,
    bootstrapTags,
    refreshSongCount,
    ensureSongPage,
    loadAllSongsForCurrentSort,
    loadSortedSongIds,
    loadSongsByIdsInBatches,
    refreshAlbums,
    refreshArtists,
    refreshTags,
    openAlbum,
    openArtist,
    openArtistAlbum,
    handleCreateTag,
    handleRenameTag,
    handleSetTagColor,
    handleDeleteTag,
    handleToggleSongColumn,
    handleMoveSongColumn,
    handleResetSongColumns,
    handleSongSortClick,
  };
}
