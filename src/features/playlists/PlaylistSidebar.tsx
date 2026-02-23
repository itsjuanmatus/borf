import { FolderPlus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import type { PlaylistNode } from "../../types";
import { PlaylistContextMenu } from "./PlaylistContextMenu";
import { PlaylistTree } from "./PlaylistTree";

interface PlaylistSidebarProps {
  playlists: PlaylistNode[];
  activePlaylistId: string | null;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenamePlaylist: (playlist: PlaylistNode) => void;
  onDeletePlaylist: (playlist: PlaylistNode) => void;
  onDuplicatePlaylist: (playlist: PlaylistNode) => void;
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
}: PlaylistSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: PlaylistNode | null;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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
    <section className="mt-4 rounded-xl border border-border bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Playlists</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onCreatePlaylist(null)}
            title="New playlist"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onCreateFolder(null)}
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
            onCreatePlaylist={onCreatePlaylist}
            onCreateFolder={onCreateFolder}
            onRename={onRenamePlaylist}
            onDelete={onDeletePlaylist}
            onDuplicate={onDuplicatePlaylist}
          />
        </div>
      ) : null}
    </section>
  );
}
