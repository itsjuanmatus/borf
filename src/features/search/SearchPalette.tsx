import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { libraryApi } from "../../lib/api";
import { cn } from "../../lib/utils";
import type {
  PlaylistNode,
  PlaylistSearchItem,
  SearchPaletteItem,
  SearchPaletteItemKind,
  SearchPaletteResult,
  SongListItem,
  Tag,
} from "../../types";

const SEARCH_DEBOUNCE_MS = 40;
const SEARCH_RESULT_LIMIT = 30;
const SEARCH_MIN_TEXT_LENGTH = 1;
const SEARCH_REMOTE_TIMEOUT_MS = 800;

const EMPTY_ACTION_ITEMS: SearchPaletteItem[] = [
  {
    kind: "action",
    id: "action.play_top_result",
    title: "Play Top Result",
    subtitle: "Play the best current match",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.play_top_result",
  },
  {
    kind: "action",
    id: "action.queue_top_song",
    title: "Queue Top Song",
    subtitle: "Add the top matching song to Up Next",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.queue_top_song",
  },
  {
    kind: "action",
    id: "action.open_songs",
    title: "Open Songs View",
    subtitle: "Jump to your full library",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_songs",
  },
  {
    kind: "action",
    id: "action.open_albums",
    title: "Open Albums View",
    subtitle: "Browse albums",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_albums",
  },
  {
    kind: "action",
    id: "action.open_artists",
    title: "Open Artists View",
    subtitle: "Browse artists",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_artists",
  },
  {
    kind: "action",
    id: "action.open_playlists",
    title: "Open Playlists",
    subtitle: "Jump to playlists",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_playlists",
  },
  {
    kind: "action",
    id: "action.open_settings",
    title: "Open Settings",
    subtitle: "Open app settings",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_settings",
  },
  {
    kind: "action",
    id: "action.open_history",
    title: "Open History",
    subtitle: "Show recent plays",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_history",
  },
  {
    kind: "action",
    id: "action.open_stats",
    title: "Open Stats",
    subtitle: "Show listening stats",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.open_stats",
  },
  {
    kind: "action",
    id: "action.scan_music_folder",
    title: "Scan Music Folder",
    subtitle: "Import files from a folder",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.scan_music_folder",
  },
  {
    kind: "action",
    id: "action.import_itunes_library",
    title: "Import iTunes Library",
    subtitle: "Run iTunes XML import",
    score: 1,
    rank_reason: null,
    song: null,
    album: null,
    artist: null,
    playlist: null,
    action_id: "action.import_itunes_library",
  },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_KIND_PREFIXES: Record<string, SearchPaletteItemKind> = {
  song: "song",
  songs: "song",
  album: "album",
  albums: "album",
  artist: "artist",
  artists: "artist",
  playlist: "playlist",
  playlists: "playlist",
  folder: "folder",
  folders: "folder",
  action: "action",
  actions: "action",
};

interface InlineTagGroup {
  term: string;
  tagIds: string[];
  tagNames: string[];
  isExact: boolean;
}

function parseSearchQuery(query: string) {
  const textTerms: string[] = [];
  const tagTerms: string[] = [];
  let kindFilter: SearchPaletteItemKind | null = null;

  for (const rawTerm of query.split(/\s+/)) {
    if (!rawTerm) {
      continue;
    }

    if (rawTerm.toLowerCase().startsWith("tag:")) {
      const value = normalizeText(rawTerm.split(":").slice(1).join(":"));
      if (value) {
        tagTerms.push(value);
      }
      continue;
    }

    const [prefix, ...restParts] = rawTerm.split(":");
    if (prefix && restParts.length > 0) {
      const resolvedKind = SEARCH_KIND_PREFIXES[prefix.toLowerCase()];
      if (resolvedKind) {
        kindFilter = resolvedKind;
        const scopedText = restParts.join(":").trim();
        if (scopedText.length > 0) {
          textTerms.push(scopedText);
        }
        continue;
      }
    }

    textTerms.push(rawTerm);
  }

  return {
    text: normalizeText(textTerms.join(" ")),
    tagNames: Array.from(new Set(tagTerms)),
    kindFilter,
  };
}

function resolveInlineTagGroups(tagTerms: string[], tags: Tag[]) {
  const groups: InlineTagGroup[] = [];
  const unresolvedTerms: string[] = [];
  const normalizedTags = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    normalized: normalizeText(tag.name),
  }));

  for (const term of Array.from(new Set(tagTerms))) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) {
      continue;
    }

    const exactMatches = normalizedTags.filter((tag) => tag.normalized === normalizedTerm);
    const isExact = exactMatches.length > 0;
    const matches = isExact
      ? exactMatches
      : normalizedTags.filter(
          (tag) =>
            tag.normalized.startsWith(normalizedTerm) ||
            tag.normalized.includes(normalizedTerm) ||
            normalizedTerm.startsWith(tag.normalized),
        );

    if (matches.length === 0) {
      unresolvedTerms.push(normalizedTerm);
      continue;
    }

    groups.push({
      term: normalizedTerm,
      tagIds: Array.from(new Set(matches.map((tag) => tag.id))),
      tagNames: Array.from(new Set(matches.map((tag) => tag.name))),
      isExact,
    });
  }

  return {
    groups,
    unresolvedTerms,
  };
}

function scoreText(query: string, fields: string[]) {
  if (!query) {
    return 0;
  }

  let score = 0;
  for (const rawField of fields) {
    const field = normalizeText(rawField);
    if (!field) {
      continue;
    }

    if (field === query) {
      score = Math.max(score, 1);
      continue;
    }
    if (field.startsWith(query)) {
      score = Math.max(score, 0.94);
      continue;
    }
    if (field.includes(query)) {
      score = Math.max(score, 0.74);
      continue;
    }

    const queryTokens = query.split(" ");
    const fieldTokens = field.split(" ");
    let matched = 0;
    for (const queryToken of queryTokens) {
      if (fieldTokens.some((token) => token.startsWith(queryToken) || token.includes(queryToken))) {
        matched += 1;
      }
    }

    const overlap = matched / queryTokens.length;
    if (overlap > 0) {
      score = Math.max(score, 0.4 + overlap * 0.3);
    }
  }

  return Math.min(1, score);
}

function playlistItemKind(item: PlaylistNode): "playlist" | "folder" {
  return item.is_folder ? "folder" : "playlist";
}

function itemKindLabel(item: SearchPaletteItem) {
  switch (item.kind) {
    case "song":
      return "Song";
    case "album":
      return "Album";
    case "artist":
      return "Artist";
    case "playlist":
      return "Playlist";
    case "folder":
      return "Folder";
    case "action":
      return "Action";
    default:
      return "Result";
  }
}

const PALETTE_KIND_RANK: Record<SearchPaletteItem["kind"], number> = {
  song: 0,
  album: 1,
  artist: 2,
  playlist: 3,
  folder: 4,
  action: 5,
};

const SCOPED_TITLE_MIN_SCORE: Record<SearchPaletteItemKind, number> = {
  song: 0.2,
  album: 0.22,
  artist: 0.25,
  playlist: 0.2,
  folder: 0.2,
  action: 0.3,
};

function matchesScopedTitleQuery(item: SearchPaletteItem, query: string) {
  const threshold = SCOPED_TITLE_MIN_SCORE[item.kind] ?? 0.2;
  return scoreText(query, [item.title]) >= threshold;
}

function sortPaletteItems(items: SearchPaletteItem[]) {
  items.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (PALETTE_KIND_RANK[left.kind] !== PALETTE_KIND_RANK[right.kind]) {
      return PALETTE_KIND_RANK[left.kind] - PALETTE_KIND_RANK[right.kind];
    }
    return left.title.localeCompare(right.title);
  });
  return items;
}

function sliceWithKindCoverage(
  items: SearchPaletteItem[],
  limit: number,
  options: { scopeKind: SearchPaletteItemKind | null; tagOnlySearch: boolean },
) {
  if (limit <= 0) {
    return [] as SearchPaletteItem[];
  }

  if (options.scopeKind || options.tagOnlySearch) {
    return items.slice(0, limit);
  }

  const selected: SearchPaletteItem[] = [];
  const seen = new Set<string>();
  const addByKind = (kind: SearchPaletteItem["kind"], count: number) => {
    if (count <= 0 || selected.length >= limit) {
      return;
    }
    for (const item of items) {
      if (selected.length >= limit) {
        return;
      }
      const key = `${item.kind}:${item.id}`;
      if (item.kind !== kind || seen.has(key)) {
        continue;
      }
      selected.push(item);
      seen.add(key);
      if (selected.filter((candidate) => candidate.kind === kind).length >= count) {
        return;
      }
    }
  };

  addByKind("playlist", 6);
  addByKind("folder", 4);

  for (const item of items) {
    if (selected.length >= limit) {
      break;
    }
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    selected.push(item);
    seen.add(key);
  }

  return selected.slice(0, limit);
}

function matchesScopeKind(
  kind: SearchPaletteItem["kind"],
  scopeKind: SearchPaletteItemKind | null,
) {
  if (!scopeKind) {
    return true;
  }
  return scopeKind === kind;
}

interface SearchPaletteProps {
  isOpen: boolean;
  selectedTagFilterIds: string[];
  localSongs: SongListItem[];
  playlists: PlaylistNode[];
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onExecuteItem: (
    item: SearchPaletteItem,
    context: { items: SearchPaletteItem[] },
  ) => void | Promise<void>;
  onError: (error: unknown) => void;
}

export function SearchPalette({
  isOpen,
  selectedTagFilterIds,
  localSongs,
  playlists,
  tags,
  onOpenChange,
  onExecuteItem,
  onError,
}: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onErrorRef = useRef(onError);
  const latestRemoteTokenRef = useRef(0);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteResult, setRemoteResult] = useState<SearchPaletteResult | null>(null);
  const [isRemoteSearching, setIsRemoteSearching] = useState(false);

  const parsedDebouncedQuery = useMemo(() => parseSearchQuery(debouncedQuery), [debouncedQuery]);
  const scopeKind = parsedDebouncedQuery.kindFilter;
  const scopedResultLimit = scopeKind ? 100 : SEARCH_RESULT_LIMIT;
  const inlineTagResolution = useMemo(
    () => resolveInlineTagGroups(parsedDebouncedQuery.tagNames, tags),
    [parsedDebouncedQuery.tagNames, tags],
  );
  const inlineTagGroups = inlineTagResolution.groups;
  const unresolvedInlineTagTerms = inlineTagResolution.unresolvedTerms;
  const hasInlineTagQuery = parsedDebouncedQuery.tagNames.length > 0;
  const hasAnyTagFilter = selectedTagFilterIds.length > 0 || hasInlineTagQuery;
  const tagOnlySearch = !parsedDebouncedQuery.text && hasAnyTagFilter;
  const remoteRequiredTagIds = useMemo(() => {
    const ids = [...selectedTagFilterIds];
    for (const group of inlineTagGroups) {
      // Remote API only supports AND semantics. Pass exact single-tag groups to avoid false negatives.
      if (group.isExact && group.tagIds.length === 1) {
        ids.push(group.tagIds[0]);
      }
    }
    return Array.from(new Set(ids));
  }, [inlineTagGroups, selectedTagFilterIds]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!isOpen) {
      latestRemoteTokenRef.current += 1;
      setQuery("");
      setDebouncedQuery("");
      setActiveIndex(0);
      setRemoteResult(null);
      setIsRemoteSearching(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!parsedDebouncedQuery.text && !hasAnyTagFilter) {
      setRemoteResult(null);
      setIsRemoteSearching(false);
      return;
    }

    if (!parsedDebouncedQuery.text && remoteRequiredTagIds.length === 0) {
      setRemoteResult(null);
      setIsRemoteSearching(false);
      return;
    }

    const token = latestRemoteTokenRef.current + 1;
    latestRemoteTokenRef.current = token;
    setRemoteResult(null);
    setIsRemoteSearching(true);

    const timeout = window.setTimeout(() => {
      if (token !== latestRemoteTokenRef.current) {
        return;
      }
      setIsRemoteSearching(false);
    }, SEARCH_REMOTE_TIMEOUT_MS);

    void libraryApi
      .searchPalette(
        parsedDebouncedQuery.text,
        scopeKind ? 200 : SEARCH_RESULT_LIMIT,
        remoteRequiredTagIds,
      )
      .then((result) => {
        if (token !== latestRemoteTokenRef.current) {
          return;
        }
        let scopedItems = result.items.filter((item) => matchesScopeKind(item.kind, scopeKind));
        if (scopeKind && parsedDebouncedQuery.text) {
          scopedItems = scopedItems.filter((item) =>
            matchesScopedTitleQuery(item, parsedDebouncedQuery.text),
          );
        }
        if (tagOnlySearch) {
          scopedItems = scopedItems.filter((item) => item.kind === "song");
        }
        setRemoteResult({
          ...result,
          items: scopedItems,
        });
      })
      .catch((error: unknown) => {
        if (token !== latestRemoteTokenRef.current) {
          return;
        }
        onErrorRef.current(error);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (token === latestRemoteTokenRef.current) {
          setIsRemoteSearching(false);
        }
      });

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    hasAnyTagFilter,
    isOpen,
    parsedDebouncedQuery.text,
    remoteRequiredTagIds,
    scopeKind,
    tagOnlySearch,
  ]);

  const fallbackAlbums = useMemo(() => {
    const map = new Map<string, { album: string; albumArtist: string }>();
    for (const song of localSongs) {
      const album = song.album || "Unknown Album";
      const albumArtist = song.artist || "Unknown Artist";
      const key = `${album}::${albumArtist}`;
      if (!map.has(key)) {
        map.set(key, { album, albumArtist });
      }
    }
    return Array.from(map.values());
  }, [localSongs]);

  const fallbackArtists = useMemo(() => {
    return Array.from(
      new Set(
        localSongs.map((song) => (song.artist || "Unknown Artist").trim() || "Unknown Artist"),
      ),
    );
  }, [localSongs]);

  const localSearchResult = useMemo<SearchPaletteResult | null>(() => {
    if (!isOpen) {
      return null;
    }

    const startedAt = performance.now();
    const queryText = parsedDebouncedQuery.text;
    const hasTextQuery = queryText.length >= SEARCH_MIN_TEXT_LENGTH;
    const includeKind = (kind: SearchPaletteItemKind) => matchesScopeKind(kind, scopeKind);
    const songMatchesTagFilters = (song: SongListItem) => {
      if (hasInlineTagQuery && inlineTagGroups.length === 0) {
        return false;
      }
      const songTagIds = new Set(song.tags.map((tag) => tag.id));
      if (selectedTagFilterIds.some((tagId) => !songTagIds.has(tagId))) {
        return false;
      }
      if (inlineTagGroups.some((group) => !group.tagIds.some((tagId) => songTagIds.has(tagId)))) {
        return false;
      }
      return true;
    };

    if (!hasTextQuery && !hasAnyTagFilter) {
      if (scopeKind && scopeKind !== "action") {
        return {
          items: [],
          took_ms: performance.now() - startedAt,
        };
      }

      return {
        items: EMPTY_ACTION_ITEMS,
        took_ms: performance.now() - startedAt,
      };
    }

    const items: SearchPaletteItem[] = [];

    if (includeKind("song")) {
      for (const song of localSongs) {
        if (!songMatchesTagFilters(song)) {
          continue;
        }

        const score = hasTextQuery
          ? scoreText(queryText, [
              song.title,
              ...(scopeKind === "song"
                ? []
                : [song.artist, song.album, `${song.title} ${song.artist} ${song.album}`]),
            ])
          : 0.4;
        if (hasTextQuery && score < 0.2) {
          continue;
        }

        items.push({
          kind: "song",
          id: song.id,
          title: song.title,
          subtitle: `${song.artist} • ${song.album}`,
          score,
          rank_reason: null,
          song,
          album: null,
          artist: null,
          playlist: null,
          action_id: null,
        });
      }
    }

    if (!tagOnlySearch && includeKind("album")) {
      for (const album of fallbackAlbums) {
        const score = hasTextQuery
          ? scoreText(queryText, [
              album.album,
              ...(scopeKind === "album"
                ? []
                : [album.albumArtist, `${album.album} ${album.albumArtist}`]),
            ])
          : 0;
        if (hasTextQuery && score < 0.22) {
          continue;
        }

        items.push({
          kind: "album",
          id: `album:${album.album}::${album.albumArtist}`,
          title: album.album,
          subtitle: `Album • ${album.albumArtist}`,
          score,
          rank_reason: null,
          song: null,
          album: {
            album: album.album,
            album_artist: album.albumArtist,
          },
          artist: null,
          playlist: null,
          action_id: null,
        });
      }
    }

    if (!tagOnlySearch && includeKind("artist")) {
      for (const artist of fallbackArtists) {
        const score = hasTextQuery ? scoreText(queryText, [artist]) : 0;
        if (hasTextQuery && score < 0.25) {
          continue;
        }

        items.push({
          kind: "artist",
          id: `artist:${artist}`,
          title: artist,
          subtitle: "Artist",
          score,
          rank_reason: null,
          song: null,
          album: null,
          artist,
          playlist: null,
          action_id: null,
        });
      }
    }

    const playlistNameById = new Map<string, string>();
    for (const playlist of playlists) {
      playlistNameById.set(playlist.id, playlist.name);
    }

    for (const playlist of playlists) {
      const kind = playlistItemKind(playlist);
      if (tagOnlySearch || !includeKind(kind)) {
        continue;
      }

      const parentName = playlist.parent_id
        ? (playlistNameById.get(playlist.parent_id) ?? null)
        : null;
      const score = hasTextQuery
        ? scopeKind
          ? scoreText(queryText, [playlist.name])
          : scoreText(queryText, [
              playlist.name,
              parentName ?? "",
              `${playlist.name} ${parentName ?? ""}`,
            ])
        : 0;
      if (hasTextQuery && score < (scopeKind ? 0.2 : 0.12)) {
        continue;
      }

      const playlistItem: PlaylistSearchItem = {
        id: playlist.id,
        name: playlist.name,
        parent_id: playlist.parent_id,
        parent_name: parentName,
        is_folder: playlist.is_folder,
      };

      items.push({
        kind: playlistItemKind(playlist),
        id: `${playlist.is_folder ? "folder" : "playlist"}:${playlist.id}`,
        title: playlist.name,
        subtitle: playlist.is_folder
          ? parentName
            ? `Folder • ${parentName}`
            : "Folder"
          : parentName
            ? `Playlist • ${parentName}`
            : "Playlist",
        score,
        rank_reason: null,
        song: null,
        album: null,
        artist: null,
        playlist: playlistItem,
        action_id: null,
      });
    }

    if (!tagOnlySearch && includeKind("action")) {
      for (const action of EMPTY_ACTION_ITEMS) {
        const score = hasTextQuery
          ? scoreText(queryText, [action.title, action.subtitle ?? ""])
          : action.score;
        if (hasTextQuery && score < 0.3) {
          continue;
        }

        items.push({
          ...action,
          score,
        });
      }
    }

    sortPaletteItems(items);

    return {
      items: sliceWithKindCoverage(items, scopedResultLimit, {
        scopeKind,
        tagOnlySearch,
      }),
      took_ms: performance.now() - startedAt,
    };
  }, [
    fallbackAlbums,
    fallbackArtists,
    isOpen,
    localSongs,
    parsedDebouncedQuery.text,
    playlists,
    hasAnyTagFilter,
    hasInlineTagQuery,
    inlineTagGroups,
    selectedTagFilterIds,
    scopedResultLimit,
    scopeKind,
    tagOnlySearch,
  ]);

  const effectiveResult = useMemo<SearchPaletteResult | null>(() => {
    if (!remoteResult) {
      return localSearchResult;
    }
    if (!localSearchResult) {
      return remoteResult;
    }

    const merged = new Map<string, SearchPaletteItem>();
    for (const item of remoteResult.items) {
      merged.set(`${item.kind}:${item.id}`, item);
    }
    for (const item of localSearchResult.items) {
      const key = `${item.kind}:${item.id}`;
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    }

    const items = Array.from(merged.values());
    sortPaletteItems(items);

    return {
      items: sliceWithKindCoverage(items, scopedResultLimit, {
        scopeKind,
        tagOnlySearch,
      }),
      took_ms: Math.min(remoteResult.took_ms, localSearchResult.took_ms),
    };
  }, [localSearchResult, remoteResult, scopeKind, scopedResultLimit, tagOnlySearch]);
  const visibleItems = effectiveResult?.items ?? [];
  const matchedInlineTagNames = useMemo(
    () => Array.from(new Set(inlineTagGroups.flatMap((group) => group.tagNames))).slice(0, 6),
    [inlineTagGroups],
  );

  useEffect(() => {
    setActiveIndex((current) => {
      if (visibleItems.length === 0) {
        return 0;
      }
      return Math.min(current, visibleItems.length - 1);
    });
  }, [visibleItems]);

  const executeItem = (item: SearchPaletteItem) => {
    void Promise.resolve(onExecuteItem(item, { items: visibleItems }))
      .then(() => {
        setQuery("");
        setDebouncedQuery("");
        setActiveIndex(0);
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        onErrorRef.current(error);
      });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close search palette"
        className="absolute inset-0 bg-night/65 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-border-dark/60 bg-night shadow-2xl">
        <div className="border-b border-border-dark/60 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-on-dark" />
            <Input
              ref={inputRef}
              value={query}
              placeholder="Search... Try album:mitty, song:deadlock, playlist:roadtrip, folder:mixes, tag:chill"
              className="h-11 bg-cloud/7 pl-10"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onOpenChange(false);
                  return;
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (visibleItems.length === 0) {
                    return;
                  }
                  setActiveIndex((current) => (current + 1) % visibleItems.length);
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (visibleItems.length === 0) {
                    return;
                  }
                  setActiveIndex((current) =>
                    current === 0 ? visibleItems.length - 1 : current - 1,
                  );
                  return;
                }

                if (event.key === "Enter") {
                  event.preventDefault();
                  const item = visibleItems[activeIndex] ?? visibleItems[0];
                  if (!item) {
                    return;
                  }
                  executeItem(item);
                }
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-on-dark">
            <span>Esc to close</span>
            <span>
              {isRemoteSearching
                ? "Searching..."
                : effectiveResult
                  ? `${effectiveResult.took_ms.toFixed(1)}ms`
                  : ""}
            </span>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-auto p-2">
          {isRemoteSearching && visibleItems.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-muted-on-dark">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Searching library...
            </div>
          ) : null}

          {visibleItems.length === 0 ? (
            <div className="space-y-1 px-3 py-3 text-sm text-muted-on-dark">
              <p>
                No matches. Try another query or <code>tag:tag-name</code>.
              </p>
              {matchedInlineTagNames.length > 0 ? (
                <p className="text-xs">
                  Similar tags:{" "}
                  <span className="text-cloud">{matchedInlineTagNames.join(", ")}</span>
                </p>
              ) : null}
              {unresolvedInlineTagTerms.length > 0 ? (
                <p className="text-xs">
                  No close tag found for:{" "}
                  <span className="text-cloud">{unresolvedInlineTagTerms.join(", ")}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {visibleItems.map((item, index) => {
            const songTagNames = item.song?.tags.map((tag) => tag.name) ?? [];
            const songTagText =
              songTagNames.length > 4
                ? `${songTagNames.slice(0, 4).join(", ")} +${songTagNames.length - 4}`
                : songTagNames.join(", ");

            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-3 py-2 text-left",
                  index === activeIndex ? "bg-cloud/14" : "hover:bg-cloud/8",
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => executeItem(item)}
              >
                <span className="rounded-full border border-border-dark/80 bg-cloud/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-on-dark">
                  {itemKindLabel(item)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-cloud">{item.title}</span>
                  {item.subtitle ? (
                    <span className="block truncate text-xs text-muted-on-dark">
                      {item.subtitle}
                    </span>
                  ) : null}
                  {songTagText ? (
                    <span className="block truncate text-[11px] text-muted-on-dark">
                      Tags: {songTagText}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] text-muted-on-dark">↵</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
