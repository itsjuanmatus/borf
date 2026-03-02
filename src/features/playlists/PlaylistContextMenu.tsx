import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import type { PlaylistNode } from "../../types";

interface PlaylistContextMenuProps {
  x: number;
  y: number;
  target: PlaylistNode | null;
  onClose: () => void;
  onCreatePlaylist: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRename: (playlist: PlaylistNode) => void;
  onDelete: (playlist: PlaylistNode) => void;
  onDuplicate: (playlist: PlaylistNode) => void;
  onExportM3u8?: (playlist: PlaylistNode) => void;
}

export function PlaylistContextMenu({
  x,
  y,
  target,
  onClose,
  onCreatePlaylist,
  onCreateFolder,
  onRename,
  onDelete,
  onDuplicate,
  onExportM3u8,
}: PlaylistContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const parentId = target?.is_folder ? target.id : (target?.parent_id ?? null);
  const menuVariantKey = `${target?.is_folder ? "folder" : "playlist"}:${onExportM3u8 ? "export" : "no-export"}`;

  useLayoutEffect(() => {
    // Re-measure when the menu options change (folder vs playlist, export action availability).
    void menuVariantKey;
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const pad = 8;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(pad, Math.min(x, window.innerWidth - width - pad));
    const spaceBelow = window.innerHeight - y - pad;
    const spaceAbove = y - pad;
    const shouldOpenAbove = spaceBelow < height && spaceAbove > spaceBelow;
    const anchorTop = shouldOpenAbove ? y - height : y;
    const top = Math.max(pad, Math.min(anchorTop, window.innerHeight - height - pad));
    setPosition({ left, top });
  }, [x, y, menuVariantKey]);

  useEffect(() => {
    const reposition = () => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }
      const pad = 8;
      const { width, height } = menu.getBoundingClientRect();
      const left = Math.max(pad, Math.min(x, window.innerWidth - width - pad));
      const spaceBelow = window.innerHeight - y - pad;
      const spaceAbove = y - pad;
      const shouldOpenAbove = spaceBelow < height && spaceAbove > spaceBelow;
      const anchorTop = shouldOpenAbove ? y - height : y;
      const top = Math.max(pad, Math.min(anchorTop, window.innerHeight - height - pad));
      setPosition({ left, top });
    };

    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
    };
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className={`fixed z-50 w-52 rounded-2xl border border-border-dark bg-night p-1 shadow-xl transition-opacity duration-75 ${position ? "opacity-100" : "opacity-0"}`}
      style={position ?? { left: x, top: y }}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-start rounded-xl text-cloud hover:bg-cloud/10 hover:text-cloud"
        onClick={() => {
          onCreatePlaylist(parentId);
          onClose();
        }}
      >
        New Playlist
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-start rounded-xl text-cloud hover:bg-cloud/10 hover:text-cloud"
        onClick={() => {
          onCreateFolder(parentId);
          onClose();
        }}
      >
        New Folder
      </Button>
      {target ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start rounded-xl text-cloud hover:bg-cloud/10 hover:text-cloud"
            onClick={() => {
              onRename(target);
              onClose();
            }}
          >
            Rename
          </Button>
          {!target.is_folder ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start rounded-xl text-cloud hover:bg-cloud/10 hover:text-cloud"
              onClick={() => {
                onDuplicate(target);
                onClose();
              }}
            >
              Duplicate
            </Button>
          ) : null}
          {!target.is_folder && onExportM3u8 ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-full justify-start rounded-xl text-cloud hover:bg-cloud/10 hover:text-cloud"
              onClick={() => {
                onExportM3u8(target);
                onClose();
              }}
            >
              Export as M3U8
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start rounded-xl text-red-400 hover:bg-cloud/10 hover:text-red-400"
            onClick={() => {
              onDelete(target);
              onClose();
            }}
          >
            Delete
          </Button>
        </>
      ) : null}
    </div>
  );
}
