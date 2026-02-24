import { useEffect } from "react";
import { playlistApi } from "../../../lib/api";
import type { LibraryView } from "../../../types";

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

interface UseGlobalKeyboardShortcutsParams {
  activeView: LibraryView;
  activePlaylistId: string | null;
  activePlaylistIsFolder: boolean;
  selectedSongIds: string[];
  copySelectionToClipboard: () => void;
  clipboardSongIds: string[];
  refreshPlaylistTracks: (playlistId: string) => Promise<void>;
  setClipboardHint: (hint: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  closeUpNext: () => void;
  isSearchPaletteOpen: boolean;
  setIsSearchPaletteOpen: (open: boolean | ((previous: boolean) => boolean)) => void;
  goBack: () => void;
  goForward: () => void;
}

export function useGlobalKeyboardShortcuts({
  activeView,
  activePlaylistId,
  activePlaylistIsFolder,
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
}: UseGlobalKeyboardShortcutsParams) {
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

          if (activeView !== "playlist" || !activePlaylistId || activePlaylistIsFolder) {
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
    activePlaylistId,
    activePlaylistIsFolder,
    activeView,
    clipboardSongIds,
    closeUpNext,
    copySelectionToClipboard,
    goBack,
    goForward,
    isSearchPaletteOpen,
    refreshPlaylistTracks,
    selectedSongIds,
    setClipboardHint,
    setErrorMessage,
    setIsSearchPaletteOpen,
  ]);
}
