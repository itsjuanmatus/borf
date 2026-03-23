import { useCallback } from "react";
import type { PlaylistNode, SearchPaletteItem, SongListItem } from "../../../types";
import type { NavigationRoute } from "../navigation/navigation-types";

interface UseSearchPaletteActionHandlerParams {
  activePlaylistId: string | null;
  playlists: PlaylistNode[];
  applyRoute: (route: NavigationRoute) => Promise<void>;
  openPlaylist: (playlistId: string) => void;
  setStatusMessage: (message: string) => void;
  setQueueSourceIds: (ids: string[]) => void;
  setQueueSourceLabel: (label: string) => void;
  replaceQueueAndPlay: (songs: SongListItem[], index: number) => Promise<void>;
  enqueueSongs: (songs: SongListItem[]) => void;
  handlePickFolderAndScan: () => Promise<void>;
  openImportWizard: () => void;
}

export function useSearchPaletteActionHandler({
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
}: UseSearchPaletteActionHandlerParams) {
  return useCallback(
    async (item: SearchPaletteItem, context: { items: SearchPaletteItem[] }) => {
      const executeNonActionItem = async (targetItem: SearchPaletteItem | null) => {
        if (!targetItem) {
          return;
        }

        if (targetItem.kind === "song" && targetItem.song) {
          setQueueSourceIds([targetItem.song.id]);
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
          openImportWizard();
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
      openImportWizard,
      openPlaylist,
      playlists,
      replaceQueueAndPlay,
      setQueueSourceLabel,
      setQueueSourceIds,
      setStatusMessage,
    ],
  );
}
