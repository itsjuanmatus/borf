import { FolderPlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { TextInputDialog } from "../../components/ui/TextInputDialog";
import type { PlaylistNode } from "../../types";
import { PlaylistContextMenu } from "./PlaylistContextMenu";
import { PlaylistTree } from "./PlaylistTree";

interface PlaylistSidebarProps {
  playlists: PlaylistNode[];
  activePlaylistId: string | null;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (parentId: string | null, name: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenamePlaylist: (playlist: PlaylistNode, nextName: string) => void;
  onDeletePlaylist: (playlist: PlaylistNode) => void;
  onDuplicatePlaylist: (playlist: PlaylistNode) => void;
  onExportM3u8?: (playlist: PlaylistNode) => void;
}

interface PlaylistNameDialogState {
  kind: "create-playlist" | "create-folder" | "rename-playlist";
  parentId: string | null;
  playlist: PlaylistNode | null;
  title: string;
  confirmLabel: string;
  initialValue: string;
}

export function PlaylistSidebar({
  playlists,
  activePlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onCreateFolder,
  onRenamePlaylist,
  onDeletePlaylist,
  onDuplicatePlaylist,
  onExportM3u8,
}: PlaylistSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: PlaylistNode | null;
  } | null>(null);
  const [nameDialog, setNameDialog] = useState<PlaylistNameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlaylistNode | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const nameDialogKey = nameDialog
    ? `${nameDialog.kind}:${nameDialog.playlist?.id ?? nameDialog.parentId ?? "root"}:${nameDialog.initialValue}`
    : "playlist-name-dialog-closed";

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (contextMenuRef.current?.contains(target)) {
        return;
      }
      setContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  return (
    <section className="mt-4 border-t border-border-dark pt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
          Playlists
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
            onClick={() => {
              setNameDialog({
                kind: "create-playlist",
                parentId: null,
                playlist: null,
                title: "New Playlist",
                confirmLabel: "Create",
                initialValue: "New Playlist",
              });
            }}
            title="New playlist"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
            onClick={() => {
              setNameDialog({
                kind: "create-folder",
                parentId: null,
                playlist: null,
                title: "New Folder",
                confirmLabel: "Create",
                initialValue: "New Folder",
              });
            }}
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <PlaylistTree
        playlists={playlists}
        activePlaylistId={activePlaylistId}
        onSelectPlaylist={onSelectPlaylist}
        onContextMenu={(event, node) => {
          setContextMenu({ x: event.clientX, y: event.clientY, target: node });
        }}
      />

      {contextMenu ? (
        <div ref={contextMenuRef}>
          <PlaylistContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            target={contextMenu.target}
            onClose={() => setContextMenu(null)}
            onCreatePlaylist={(parentId) => {
              setNameDialog({
                kind: "create-playlist",
                parentId,
                playlist: null,
                title: "New Playlist",
                confirmLabel: "Create",
                initialValue: "New Playlist",
              });
            }}
            onCreateFolder={(parentId) => {
              setNameDialog({
                kind: "create-folder",
                parentId,
                playlist: null,
                title: "New Folder",
                confirmLabel: "Create",
                initialValue: "New Folder",
              });
            }}
            onRename={(playlist) => {
              setNameDialog({
                kind: "rename-playlist",
                parentId: playlist.parent_id,
                playlist,
                title: "Rename",
                confirmLabel: "Save",
                initialValue: playlist.name,
              });
            }}
            onDelete={(playlist) => {
              setDeleteTarget(playlist);
            }}
            onDuplicate={onDuplicatePlaylist}
            onExportM3u8={onExportM3u8}
          />
        </div>
      ) : null}

      <TextInputDialog
        key={nameDialogKey}
        isOpen={Boolean(nameDialog)}
        title={nameDialog?.title ?? "Name"}
        initialValue={nameDialog?.initialValue ?? ""}
        confirmLabel={nameDialog?.confirmLabel ?? "Save"}
        onClose={() => setNameDialog(null)}
        onConfirm={(value) => {
          const dialog = nameDialog;
          if (!dialog) {
            return;
          }

          if (dialog.kind === "create-playlist") {
            onCreatePlaylist(dialog.parentId, value);
          } else if (dialog.kind === "create-folder") {
            onCreateFolder(dialog.parentId, value);
          } else if (dialog.playlist) {
            onRenamePlaylist(dialog.playlist, value);
          }
          setNameDialog(null);
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Playlist"
        description={
          deleteTarget ? `Delete "${deleteTarget.name}"? This action cannot be undone.` : undefined
        }
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) {
            return;
          }
          onDeletePlaylist(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}
