import type { RefObject } from "react";
import { playlistApi } from "../../../lib/api";
import type { PlaylistNode, SearchPaletteItem, SongListItem, Tag } from "../../../types";
import type { SongContextMenuState } from "../../metadata/SongContextMenu";
import type { AppDialogLayerProps } from "../layout/AppDialogLayer";
import type { useMetadataImportController } from "./useMetadataImportController";

type MetadataImportController = ReturnType<typeof useMetadataImportController>;

interface UseAppDialogLayerPropsParams {
  songContextMenu: SongContextMenuState | null;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  contextMenuPos: { left: number; top: number } | null;
  playFromPlaylistIndex: (index: number) => Promise<void>;
  playFromSongsIndex: (index: number) => Promise<void>;
  addSongsToQueue: (songIds: string[]) => void;
  setClipboardSongIds: (songIds: string[]) => void;
  setClipboardHint: (hint: string | null) => void;
  setSongContextMenu: (menu: SongContextMenuState | null) => void;
  setErrorMessage: (message: string | null) => void;
  refreshPlaylistTracks: (playlistId: string) => Promise<void>;
  activePlaylistId: string | null;
  clearSelection: () => void;
  isSearchPaletteOpen: boolean;
  selectedTagFilterIds: string[];
  paletteLocalSongs: SongListItem[];
  playlists: PlaylistNode[];
  tags: Tag[];
  setIsSearchPaletteOpen: (open: boolean) => void;
  handleExecuteSearchPaletteItem: (
    item: SearchPaletteItem,
    context: { items: SearchPaletteItem[] },
  ) => Promise<void>;
  currentPositionMs: number;
  importProgressPercent: number;
  metadataImportController: MetadataImportController;
}

export function useAppDialogLayerProps({
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
  currentPositionMs,
  importProgressPercent,
  metadataImportController,
}: UseAppDialogLayerPropsParams): AppDialogLayerProps {
  const {
    metadataTargetSongIds,
    setMetadataTargetSongIds,
    metadataTargetSongs,
    showManageTagsDialog,
    setShowManageTagsDialog,
    manageTagsSelection,
    setManageTagsSelection,
    showEditCommentDialog,
    setShowEditCommentDialog,
    showCustomStartDialog,
    setShowCustomStartDialog,
    showImportWizard,
    importWizardStep,
    setImportWizardStep,
    itunesXmlPath,
    itunesPreview,
    itunesOptions,
    setItunesOptions,
    itunesProgress,
    itunesSummary,
    isImporting,
    openManageTagsForSongs,
    applyManageTags,
    applySongComment,
    applyCustomStart,
    resetImportWizard,
    handlePickItunesXml,
    handleRunItunesImport,
  } = metadataImportController;

  const songContextMenuProps: AppDialogLayerProps["songContextMenuProps"] = {
    menu: songContextMenu,
    menuRef: contextMenuRef,
    position: contextMenuPos,
    playlists,
    onAddToPlaylist: (playlistId, songIds) => {
      void (async () => {
        try {
          await playlistApi.addSongs({ playlistId, songIds });
          await refreshPlaylistTracks(playlistId);
          const playlist = playlists.find((p) => p.id === playlistId);
          setClipboardHint(
            `Added ${songIds.length} song${songIds.length > 1 ? "s" : ""} to ${playlist?.name ?? "playlist"}`,
          );
        } catch (error: unknown) {
          setErrorMessage(String(error));
        }
      })();
    },
    onPlayFromHere: (source, index) => {
      if (source === "playlist") {
        void playFromPlaylistIndex(index).catch((error: unknown) => setErrorMessage(String(error)));
      } else {
        void playFromSongsIndex(index).catch((error: unknown) => setErrorMessage(String(error)));
      }
    },
    onRemoveFromPlaylist: (songIds) => {
      if (!activePlaylistId) return;
      void (async () => {
        try {
          await playlistApi.removeSongs(activePlaylistId, songIds);
          await refreshPlaylistTracks(activePlaylistId);
          clearSelection();
        } catch (error: unknown) {
          setErrorMessage(String(error));
        }
      })();
    },
    onAddToQueue: addSongsToQueue,
    onCopy: (songIds) => {
      setClipboardSongIds(songIds);
      setClipboardHint(`${songIds.length} song(s) copied`);
    },
    onManageTags: (songIds) => {
      void openManageTagsForSongs(songIds);
    },
    onEditComment: (songIds) => {
      setMetadataTargetSongIds(songIds);
      setShowEditCommentDialog(true);
    },
    onSetCustomStart: (songIds) => {
      setMetadataTargetSongIds(songIds);
      setShowCustomStartDialog(true);
    },
    onClose: () => setSongContextMenu(null),
  };

  const searchPaletteProps: AppDialogLayerProps["searchPaletteProps"] = {
    isOpen: isSearchPaletteOpen,
    selectedTagFilterIds,
    localSongs: paletteLocalSongs,
    playlists,
    tags,
    onOpenChange: setIsSearchPaletteOpen,
    onExecuteItem: handleExecuteSearchPaletteItem,
    onError: (error) => setErrorMessage(String(error)),
  };

  const manageTagsDialogProps: AppDialogLayerProps["manageTagsDialogProps"] = {
    isOpen: showManageTagsDialog,
    tags,
    selectedTagIds: manageTagsSelection,
    targetSongCount: metadataTargetSongIds.length,
    onToggleTag: (tagId, checked) => {
      if (checked) {
        setManageTagsSelection((previous) => [...new Set([...previous, tagId])]);
      } else {
        setManageTagsSelection((previous) => previous.filter((value) => value !== tagId));
      }
    },
    onClose: () => setShowManageTagsDialog(false),
    onApply: () => {
      void applyManageTags();
    },
  };

  const editCommentDialogProps: AppDialogLayerProps["editCommentDialogProps"] = {
    isOpen: showEditCommentDialog,
    initialComment: metadataTargetSongs[0]?.comment ?? null,
    targetSongCount: metadataTargetSongIds.length,
    onClose: () => setShowEditCommentDialog(false),
    onSave: (comment) => {
      void applySongComment(comment);
    },
  };

  const setCustomStartDialogProps: AppDialogLayerProps["setCustomStartDialogProps"] = {
    isOpen: showCustomStartDialog,
    initialMs: metadataTargetSongs[0]?.custom_start_ms ?? 0,
    currentPositionMs,
    targetSongCount: metadataTargetSongIds.length,
    onClose: () => setShowCustomStartDialog(false),
    onSave: (customStartMs) => {
      void applyCustomStart(customStartMs);
    },
  };

  const itunesImportWizardProps: AppDialogLayerProps["itunesImportWizardProps"] = {
    isOpen: showImportWizard,
    step: importWizardStep,
    xmlPath: itunesXmlPath,
    preview: itunesPreview,
    options: itunesOptions,
    progress: itunesProgress,
    summary: itunesSummary,
    isImporting,
    importProgressPercent,
    onClose: resetImportWizard,
    onPickXml: () => {
      void handlePickItunesXml();
    },
    onSetStep: setImportWizardStep,
    onToggleOption: (key, value) =>
      setItunesOptions((previous) => ({
        ...previous,
        [key]: value,
      })),
    onRunImport: () => {
      void handleRunItunesImport();
    },
  };

  return {
    songContextMenuProps,
    searchPaletteProps,
    manageTagsDialogProps,
    editCommentDialogProps,
    setCustomStartDialogProps,
    itunesImportWizardProps,
  };
}
