import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AlbumListItem, LibraryView, PlaylistNode, SongListItem } from "../../../types";
import type {
  AlbumIdentity,
  NavigationRoute,
  NavigationScrollPositions,
  NavigationSnapshot,
} from "../navigation/navigation-types";
import {
  cloneAlbumIdentity,
  navigationRouteKey,
  navigationSnapshotsEqual,
  normalizeScrollPosition,
  normalizeTagFilterIds,
} from "../navigation/navigation-utils";

interface NavigationScrollRefs {
  songsScrollRef: MutableRefObject<HTMLDivElement | null>;
  albumsScrollRef: MutableRefObject<HTMLDivElement | null>;
  albumDetailScrollRef: MutableRefObject<HTMLDivElement | null>;
  artistsScrollRef: MutableRefObject<HTMLDivElement | null>;
  artistAlbumsScrollRef: MutableRefObject<HTMLDivElement | null>;
  artistAlbumTracksScrollRef: MutableRefObject<HTMLDivElement | null>;
  playlistFolderScrollRef: MutableRefObject<HTMLDivElement | null>;
  statsScrollRef: MutableRefObject<HTMLDivElement | null>;
  settingsScrollRef: MutableRefObject<HTMLDivElement | null>;
}

interface OpenPlaylistOptions {
  clearSelection?: boolean;
  reorderMode?: boolean;
}

interface UseNavigationControllerParams {
  activeView: LibraryView;
  activePlaylistId: string | null;
  activePlaylist: PlaylistNode | null;
  selectedAlbum: AlbumListItem | null;
  selectedArtist: string | null;
  selectedArtistAlbum: AlbumListItem | null;
  searchQuery: string;
  selectedTagFilterIds: string[];
  playlistReorderMode: boolean;
  upNextOpen: boolean;
  openUpNext: () => void;
  closeUpNext: () => void;
  setSearchQuery: (query: string) => void;
  setSelectedTagFilterIds: Dispatch<SetStateAction<string[]>>;
  setPlaylistReorderMode: Dispatch<SetStateAction<boolean>>;
  setActiveView: (view: LibraryView) => void;
  setActivePlaylistId: (playlistId: string | null) => void;
  setSelectedAlbum: Dispatch<SetStateAction<AlbumListItem | null>>;
  setAlbumTracks: Dispatch<SetStateAction<SongListItem[]>>;
  setSelectedArtist: Dispatch<SetStateAction<string | null>>;
  setSelectedArtistAlbum: Dispatch<SetStateAction<AlbumListItem | null>>;
  setArtistAlbums: Dispatch<SetStateAction<AlbumListItem[]>>;
  setArtistAlbumTracks: Dispatch<SetStateAction<SongListItem[]>>;
  clearSelection: () => void;
  openAlbum: (album: AlbumIdentity, options?: { allowToggle?: boolean }) => Promise<void>;
  openArtist: (artist: string) => Promise<void>;
  openArtistAlbum: (album: AlbumIdentity) => Promise<void>;
  openPlaylist: (playlistId: string, options?: OpenPlaylistOptions) => void;
  setErrorMessage: (message: string | null) => void;
  perfViewSwitchRef: MutableRefObject<{ view: string; startedAt: number } | null>;
  scrollRefs: NavigationScrollRefs;
  maxHistory?: number;
}

export function useNavigationController({
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
  scrollRefs,
  maxHistory = 100,
}: UseNavigationControllerParams) {
  const scrollPositionsRef = useRef<NavigationScrollPositions>({});
  const pendingScrollRestoreRef = useRef<{
    route: NavigationRoute;
    scrollByRoute: NavigationScrollPositions;
  } | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const pastStackRef = useRef<NavigationSnapshot[]>([]);
  const futureStackRef = useRef<NavigationSnapshot[]>([]);

  const [pastStack, setPastStack] = useState<NavigationSnapshot[]>([]);
  const [futureStack, setFutureStack] = useState<NavigationSnapshot[]>([]);
  const [playlistRestoreScrollTop, setPlaylistRestoreScrollTop] = useState<number | null>(null);
  const [historyRestoreScrollTop, setHistoryRestoreScrollTop] = useState<number | null>(null);
  const [scrollRestoreTick, setScrollRestoreTick] = useState(0);

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
          return scrollRefs.songsScrollRef.current;
        case "albums-list":
          return scrollRefs.albumsScrollRef.current;
        case "albums-detail":
          return scrollRefs.albumDetailScrollRef.current;
        case "artists-list":
          return scrollRefs.artistsScrollRef.current;
        case "artists-detail":
          return scrollRefs.artistAlbumsScrollRef.current;
        case "artists-album-detail":
          return scrollRefs.artistAlbumTracksScrollRef.current;
        case "playlist":
          if (activePlaylistId !== route.playlistId) {
            return null;
          }
          if (activePlaylist?.is_folder) {
            return scrollRefs.playlistFolderScrollRef.current;
          }
          return null;
        case "stats":
          return scrollRefs.statsScrollRef.current;
        case "settings":
          return scrollRefs.settingsScrollRef.current;
        case "history":
          return null;
        default:
          return null;
      }
    },
    [
      activePlaylist?.is_folder,
      activePlaylistId,
      scrollRefs.albumDetailScrollRef,
      scrollRefs.albumsScrollRef,
      scrollRefs.artistAlbumTracksScrollRef,
      scrollRefs.artistAlbumsScrollRef,
      scrollRefs.artistsScrollRef,
      scrollRefs.playlistFolderScrollRef,
      scrollRefs.settingsScrollRef,
      scrollRefs.songsScrollRef,
      scrollRefs.statsScrollRef,
    ],
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
      perfViewSwitchRef,
      setActivePlaylistId,
      setActiveView,
      setAlbumTracks,
      setArtistAlbumTracks,
      setArtistAlbums,
      setSelectedAlbum,
      setSelectedArtist,
      setSelectedArtistAlbum,
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
    [
      applyRoute,
      closeUpNext,
      openUpNext,
      setErrorMessage,
      setPlaylistReorderMode,
      setSearchQuery,
      setSelectedTagFilterIds,
    ],
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
      if (nextPast.length > maxHistory) {
        nextPast.splice(0, nextPast.length - maxHistory);
      }
      setPastStackWithRef(nextPast);
      setFutureStackWithRef([]);
      return true;
    },
    [captureCurrentSnapshot, maxHistory, setFutureStackWithRef, setPastStackWithRef],
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
    if (nextFuture.length > maxHistory) {
      nextFuture.splice(maxHistory);
    }

    setPastStackWithRef(nextPast);
    setFutureStackWithRef(nextFuture);
    void applySnapshot(targetSnapshot, { fromHistory: true });
  }, [
    applySnapshot,
    captureCurrentSnapshot,
    maxHistory,
    setFutureStackWithRef,
    setPastStackWithRef,
  ]);

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
    if (nextPast.length > maxHistory) {
      nextPast.splice(0, nextPast.length - maxHistory);
    }

    setFutureStackWithRef(remainingForward);
    setPastStackWithRef(nextPast);
    void applySnapshot(targetSnapshot, { fromHistory: true });
  }, [
    applySnapshot,
    captureCurrentSnapshot,
    maxHistory,
    setFutureStackWithRef,
    setPastStackWithRef,
  ]);

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

  return {
    currentRoute,
    currentRouteKey,
    scrollPositionsRef,
    pendingScrollRestoreRef,
    scrollRestoreTick,
    playlistRestoreScrollTop,
    historyRestoreScrollTop,
    pastStack,
    futureStack,
    resolveScrollElementForRoute,
    recordScrollPositionForRoute,
    applyRoute,
    navigateToRoute,
    goBack,
    goForward,
  };
}
