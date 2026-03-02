import { type RefObject, useCallback } from "react";
import { libraryApi } from "../../../lib/api";
import type { LibraryView, SongListItem } from "../../../types";
import type { SongContextMenuState } from "../../metadata/SongContextMenu";
import type { AppMainContentProps } from "../layout/AppMainContent";
import { cloneAlbumIdentity, navigationRouteKey } from "../navigation/navigation-utils";
import type { useLibraryController } from "./useLibraryController";
import type { useNavigationController } from "./useNavigationController";
import type { usePlaybackController } from "./usePlaybackController";
import type { usePlaylistController } from "./usePlaylistController";

type LibraryController = ReturnType<typeof useLibraryController>;
type PlaylistController = ReturnType<typeof usePlaylistController>;
type PlaybackController = ReturnType<typeof usePlaybackController>;
type NavigationController = ReturnType<typeof useNavigationController>;

interface UseAppMainContentPropsParams {
  activeView: LibraryView;
  activePlaylistId: string | null;
  statsRefreshSignal: number;
  songLookupById: Map<string, SongListItem>;
  setSongContextMenu: (menu: SongContextMenuState | null) => void;
  setErrorMessage: (message: string | null) => void;
  songsScrollRef: RefObject<HTMLDivElement | null>;
  albumsScrollRef: RefObject<HTMLDivElement | null>;
  albumDetailScrollRef: RefObject<HTMLDivElement | null>;
  artistsScrollRef: RefObject<HTMLDivElement | null>;
  artistAlbumsScrollRef: RefObject<HTMLDivElement | null>;
  artistAlbumTracksScrollRef: RefObject<HTMLDivElement | null>;
  playlistFolderScrollRef: RefObject<HTMLDivElement | null>;
  statsScrollRef: RefObject<HTMLDivElement | null>;
  settingsScrollRef: RefObject<HTMLDivElement | null>;
  libraryController: LibraryController;
  playlistController: PlaylistController;
  playbackController: PlaybackController;
  navigationController: NavigationController;
  handleExportPlayStatsCsv: () => Promise<void>;
  handleExportTagsCsv: () => Promise<void>;
  handleExportHierarchyMd: () => Promise<void>;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  setCrossfadeEnabled: (enabled: boolean) => void;
  setCrossfadeSeconds: (seconds: number) => void;
}

export function useAppMainContentProps({
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
  crossfadeEnabled,
  crossfadeSeconds,
  setCrossfadeEnabled,
  setCrossfadeSeconds,
}: UseAppMainContentPropsParams): AppMainContentProps {
  const {
    songCount,
    songsByIndex,
    songsOrderedIds,
    albums,
    artists,
    isLoadingAlbums,
    isLoadingArtists,
    selectedAlbum,
    albumTracks,
    loadingAlbumTracks,
    selectedArtist,
    artistAlbums,
    selectedArtistAlbum,
    artistAlbumTracks,
    loadingArtistAlbums,
    loadingArtistAlbumTracks,
    tags,
    normalizedSongColumnOrder,
    visibleSongColumns,
    visibleSongColumnConfigs,
    songGridTemplateColumns,
    songLoadingColumnSpan,
    compactSongGridTemplateColumnsWithAction,
    songVirtualRows,
    songVirtualTotalSize,
    albumColumns,
    albumVirtualRows,
    albumVirtualTotalSize,
    artistVirtualRows,
    artistVirtualTotalSize,
    handleCreateTag,
    handleRenameTag,
    handleSetTagColor,
    handleDeleteTag,
    handleToggleSongColumn,
    handleMoveSongColumn,
    handleResetSongColumns,
    handleSongSortClick,
    songSort,
    songOrder,
  } = libraryController;

  const {
    activePlaylist,
    activeFolderChildren,
    activePlaylistTrackCount,
    activePlaylistTracksByIndex,
    selectedSongIds,
    selectedSongIdSet,
    selectSongs,
    handlePlaylistTrackSelection,
    playlistReorderMode,
    canReorderActivePlaylist,
    togglePlaylistReorderMode,
    requestPlaylistTrackRange,
    addSongsToQueue,
    removeSelectedFromActivePlaylist,
  } = playlistController;

  const {
    currentSong,
    setQueueSourceSongs,
    setQueueSourceLabel,
    replaceQueueAndPlay,
    playSong,
    playFromSongsIndex,
    playFromPlaylistIndex,
  } = playbackController;

  const {
    scrollPositionsRef,
    playlistRestoreScrollTop,
    historyRestoreScrollTop,
    recordScrollPositionForRoute,
    navigateToRoute,
  } = navigationController;

  const handlePlayHistorySong = useCallback(
    (songId: string) => {
      const cachedSong = songLookupById.get(songId);
      if (cachedSong) {
        void playSong(cachedSong).catch((error: unknown) => setErrorMessage(String(error)));
        return;
      }

      void libraryApi
        .getSongsByIds([songId])
        .then((songs) => {
          if (songs[0]) {
            void playSong(songs[0]).catch((error: unknown) => setErrorMessage(String(error)));
          }
        })
        .catch((error: unknown) => setErrorMessage(String(error)));
    },
    [playSong, setErrorMessage, songLookupById],
  );

  return {
    activeView,
    activePlaylist,
    activePlaylistId,
    activeFolderChildren,
    playlistFolderScrollRef,
    onPlaylistFolderScrollTopChange: (scrollTop) => {
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
    },
    onNavigateToPlaylist: (playlistId) => {
      void navigateToRoute(
        {
          kind: "playlist",
          playlistId,
        },
        { playlistReorderMode: false },
      );
    },
    songsViewProps: {
      songGridTemplateColumns,
      songSort,
      songOrder,
      visibleSongColumnConfigs,
      scrollRef: songsScrollRef,
      onScrollTopChange: (scrollTop) => recordScrollPositionForRoute({ kind: "songs" }, scrollTop),
      songVirtualRows,
      songVirtualTotalSize,
      songsByIndex,
      selectedSongIds,
      selectedSongIdSet,
      currentSongId: currentSong?.id ?? null,
      songLoadingColumnSpan,
      songCount,
      onSortClick: handleSongSortClick,
      onSongClick: (song, _index, modifiers) => {
        const orderedSongIds = songsOrderedIds.filter((songId): songId is string =>
          Boolean(songId),
        );
        const songIndex = orderedSongIds.indexOf(song.id);
        selectSongs({
          songId: song.id,
          songIndex: songIndex < 0 ? 0 : songIndex,
          orderedSongIds,
          mode: modifiers.shiftKey ? "range" : modifiers.metaKey ? "toggle" : "single",
        });
      },
      onSongContextMenu: (event, song, index) => {
        if (!selectedSongIdSet.has(song.id)) {
          selectSongs({
            songId: song.id,
            songIndex: 0,
            orderedSongIds: [song.id],
            mode: "single",
          });
        }
        const songIds = selectedSongIdSet.has(song.id) ? selectedSongIds : [song.id];
        setSongContextMenu({
          x: event.clientX,
          y: event.clientY,
          songIds,
          index,
          source: "library",
        });
      },
      onPlayFromIndex: (index) => {
        void playFromSongsIndex(index).catch((error: unknown) => setErrorMessage(String(error)));
      },
    },
    playlistViewProps: {
      playlist: activePlaylist,
      tracks: activePlaylistTracksByIndex,
      trackCount: activePlaylistTrackCount,
      visibleSongColumns,
      currentSongId: currentSong?.id ?? null,
      selectedSongIds,
      selectedSongIdSet,
      isReorderMode: playlistReorderMode,
      canReorder: canReorderActivePlaylist,
      onToggleReorderMode: togglePlaylistReorderMode,
      onRequestTrackRange: (startIndex, endIndex) => {
        if (activePlaylistId) {
          requestPlaylistTrackRange(activePlaylistId, startIndex, endIndex);
        }
      },
      onSelectTrack: handlePlaylistTrackSelection,
      onPlayTrack: (index) => {
        void playFromPlaylistIndex(index).catch((error: unknown) => setErrorMessage(String(error)));
      },
      onAddToQueue: (songId) => addSongsToQueue([songId]),
      onRemoveSelected: () => {
        void removeSelectedFromActivePlaylist();
      },
      onTrackContextMenu: (event, songId, index) => {
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
      },
      initialScrollTop: activePlaylistId
        ? (scrollPositionsRef.current[
            navigationRouteKey({
              kind: "playlist",
              playlistId: activePlaylistId,
            })
          ] ?? 0)
        : 0,
      restoreScrollTop: playlistRestoreScrollTop,
      onScrollTopChange: (scrollTop) => {
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
      },
    },
    albumsViewProps: {
      selectedAlbum,
      albumTracks,
      loadingAlbumTracks,
      currentSongId: currentSong?.id ?? null,
      visibleSongColumnConfigs,
      compactSongGridTemplateColumnsWithAction,
      albumDetailScrollRef,
      onAlbumDetailScrollTopChange: (scrollTop) => {
        if (!selectedAlbum) {
          return;
        }
        recordScrollPositionForRoute(
          {
            kind: "albums-detail",
            album: cloneAlbumIdentity(selectedAlbum),
          },
          scrollTop,
        );
      },
      onPlayAlbumTrack: (index) => {
        setQueueSourceSongs(albumTracks);
        setQueueSourceLabel(selectedAlbum?.album ?? "Album");
        void replaceQueueAndPlay(albumTracks, index).catch((error: unknown) =>
          setErrorMessage(String(error)),
        );
      },
      onAlbumTrackContextMenu: (event, song, index) => {
        setSongContextMenu({
          x: event.clientX,
          y: event.clientY,
          songIds: [song.id],
          index,
          source: "library",
        });
      },
      onAddSongToQueue: (songId) => addSongsToQueue([songId]),
      albumsScrollRef,
      onAlbumsListScrollTopChange: (scrollTop) =>
        recordScrollPositionForRoute({ kind: "albums-list" }, scrollTop),
      isLoadingAlbums,
      albums,
      albumColumns,
      albumVirtualRows,
      albumVirtualTotalSize,
      onSelectAlbum: (album) => {
        void navigateToRoute({
          kind: "albums-detail",
          album: cloneAlbumIdentity(album),
        });
      },
    },
    artistsViewProps: {
      selectedArtist,
      artistsScrollRef,
      onArtistsListScrollTopChange: (scrollTop) =>
        recordScrollPositionForRoute({ kind: "artists-list" }, scrollTop),
      isLoadingArtists,
      artists,
      artistVirtualRows,
      artistVirtualTotalSize,
      onSelectArtist: (artist) => {
        void navigateToRoute({
          kind: "artists-detail",
          artist,
        });
      },
      artistAlbums,
      selectedArtistAlbum,
      loadingArtistAlbums,
      loadingArtistAlbumTracks,
      artistAlbumTracks,
      artistAlbumsScrollRef,
      onArtistAlbumsScrollTopChange: (scrollTop) => {
        if (!selectedArtist) {
          return;
        }
        recordScrollPositionForRoute(
          {
            kind: "artists-detail",
            artist: selectedArtist,
          },
          scrollTop,
        );
      },
      artistAlbumTracksScrollRef,
      onArtistAlbumTracksScrollTopChange: (scrollTop) => {
        if (!selectedArtist || !selectedArtistAlbum) {
          return;
        }
        recordScrollPositionForRoute(
          {
            kind: "artists-album-detail",
            artist: selectedArtist,
            album: cloneAlbumIdentity(selectedArtistAlbum),
          },
          scrollTop,
        );
      },
      visibleSongColumnConfigs,
      compactSongGridTemplateColumnsWithAction,
      currentSongId: currentSong?.id ?? null,
      onSelectArtistAlbum: (album) => {
        if (!selectedArtist) {
          return;
        }
        void navigateToRoute({
          kind: "artists-album-detail",
          artist: selectedArtist,
          album: cloneAlbumIdentity(album),
        });
      },
      onPlayArtistAlbumTrack: (index) => {
        setQueueSourceSongs(artistAlbumTracks);
        setQueueSourceLabel(selectedArtistAlbum?.album ?? "Artist");
        void replaceQueueAndPlay(artistAlbumTracks, index).catch((error: unknown) =>
          setErrorMessage(String(error)),
        );
      },
      onArtistAlbumTrackContextMenu: (event, song, index) => {
        setSongContextMenu({
          x: event.clientX,
          y: event.clientY,
          songIds: [song.id],
          index,
          source: "library",
        });
      },
      onAddSongToQueue: (songId) => addSongsToQueue([songId]),
    },
    historyViewProps: {
      initialScrollTop: scrollPositionsRef.current[navigationRouteKey({ kind: "history" })] ?? 0,
      restoreScrollTop: historyRestoreScrollTop,
      onScrollTopChange: (scrollTop) => {
        recordScrollPositionForRoute({ kind: "history" }, scrollTop);
      },
      onPlaySong: handlePlayHistorySong,
    },
    statsScrollRef,
    onStatsScrollTopChange: (scrollTop) =>
      recordScrollPositionForRoute({ kind: "stats" }, scrollTop),
    statsRefreshSignal,
    settingsViewProps: {
      scrollRef: settingsScrollRef,
      onScrollTopChange: (scrollTop) =>
        recordScrollPositionForRoute({ kind: "settings" }, scrollTop),
      columnOrder: normalizedSongColumnOrder,
      visibleColumns: visibleSongColumns,
      onToggleColumn: handleToggleSongColumn,
      onMoveColumn: handleMoveSongColumn,
      onResetDefaults: handleResetSongColumns,
      tags,
      onCreateTag: handleCreateTag,
      onRenameTag: handleRenameTag,
      onSetTagColor: handleSetTagColor,
      onDeleteTag: handleDeleteTag,
      onExportPlayStatsCsv: () => {
        void handleExportPlayStatsCsv();
      },
      onExportTagsCsv: () => {
        void handleExportTagsCsv();
      },
      onExportHierarchyMd: () => {
        void handleExportHierarchyMd();
      },
      crossfadeEnabled,
      crossfadeSeconds,
      onCrossfadeEnabledChange: setCrossfadeEnabled,
      onCrossfadeSecondsChange: setCrossfadeSeconds,
    },
  };
}
