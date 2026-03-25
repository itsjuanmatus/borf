import { ChevronRight, Folder, ListMusic } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { PlaylistNode } from "../../types";

export interface SongContextMenuState {
  x: number;
  y: number;
  songIds: string[];
  index: number;
  source: "library" | "playlist";
}

interface SongContextMenuProps {
  menu: SongContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;
  position: { left: number; top: number } | null;
  playlists: PlaylistNode[];
  onPlayFromHere: (source: SongContextMenuState["source"], index: number) => void;
  onAddToQueue: (songIds: string[]) => void;
  onAddToPlaylist: (playlistId: string, songIds: string[]) => void;
  onRemoveFromPlaylist: (songIds: string[]) => void;
  onCopy: (songIds: string[]) => void;
  onManageTags: (songIds: string[]) => void;
  onEditComment: (songIds: string[]) => void;
  onSetCustomStart: (songIds: string[]) => void;
  onClose: () => void;
}

interface PlaylistSubmenuProps {
  playlists: PlaylistNode[];
  triggerRect: DOMRect | null;
  onSelect: (playlistId: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function PlaylistSubmenu({
  playlists,
  triggerRect,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}: PlaylistSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, PlaylistNode[]>();
    for (const playlist of playlists) {
      const parent = playlist.parent_id ?? null;
      const siblings = map.get(parent) ?? [];
      siblings.push(playlist);
      map.set(parent, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [playlists]);

  const hasPlaylists = playlists.some((p) => !p.is_folder);

  useEffect(() => {
    if (!triggerRect || !submenuRef.current) return;
    const el = submenuRef.current;
    const rect = el.getBoundingClientRect();

    let left = triggerRect.right + 4;
    let top = triggerRect.top;

    if (left + rect.width > window.innerWidth - 8) {
      left = triggerRect.left - rect.width - 4;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }

    setPlacement({ left, top });
  }, [triggerRect]);

  function renderNodes(parentId: string | null, depth: number) {
    const children = childrenByParent.get(parentId) ?? [];
    return children.map((node) => {
      if (node.is_folder) {
        const folderChildren = childrenByParent.get(node.id) ?? [];
        if (
          !folderChildren.some((c) => !c.is_folder || (childrenByParent.get(c.id)?.length ?? 0) > 0)
        ) {
          return null;
        }
        return (
          <div key={node.id}>
            <div
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-on-dark"
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate font-medium">{node.name}</span>
            </div>
            {renderNodes(node.id, depth + 1)}
          </div>
        );
      }
      return (
        <button
          key={node.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-cloud hover:bg-cloud/10"
          style={{ paddingLeft: `${12 + depth * 12}px` }}
          onClick={() => onSelect(node.id)}
        >
          <ListMusic className="h-3.5 w-3.5 shrink-0 text-muted-on-dark" />
          <span className="truncate">{node.name}</span>
        </button>
      );
    });
  }

  return (
    <div
      ref={submenuRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "fixed z-[51] max-h-72 min-w-44 overflow-y-auto rounded-2xl border border-border-dark bg-night p-1 shadow-xl transition-opacity duration-75",
        placement ? "opacity-100" : "opacity-0",
      )}
      style={placement ?? { left: triggerRect?.right ?? 0, top: triggerRect?.top ?? 0 }}
    >
      {hasPlaylists ? (
        renderNodes(null, 0)
      ) : (
        <p className="px-3 py-2 text-xs text-muted-on-dark">No playlists</p>
      )}
    </div>
  );
}

export function SongContextMenu({
  menu,
  menuRef,
  position,
  playlists,
  onPlayFromHere,
  onAddToQueue,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCopy,
  onManageTags,
  onEditComment,
  onSetCustomStart,
  onClose,
}: SongContextMenuProps) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  // Reset submenu when menu opens/closes
  useEffect(() => {
    setSubmenuOpen(false);
    setTriggerRect(null);
  }, [menu]);

  // Clean up leave timeout on unmount
  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setSubmenuOpen(true);
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    leaveTimeoutRef.current = setTimeout(() => {
      setSubmenuOpen(false);
    }, 150);
  }, []);

  if (!menu) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className={`fixed z-50 rounded-2xl border border-border-dark bg-night p-1 shadow-xl transition-opacity duration-75 ${position ? "opacity-100" : "opacity-0"}`}
      style={position ?? { left: menu.x, top: menu.y }}
    >
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onPlayFromHere(menu.source, menu.index);
          onClose();
        }}
      >
        Play from here
      </button>
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onAddToQueue(menu.songIds);
          onClose();
        }}
      >
        Add to Queue
      </button>
      <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10",
            submenuOpen && "bg-cloud/10",
          )}
        >
          Add to Playlist
          <ChevronRight className="h-3.5 w-3.5 text-muted-on-dark" />
        </button>
        {submenuOpen ? (
          <PlaylistSubmenu
            playlists={playlists}
            triggerRect={triggerRect}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onSelect={(playlistId) => {
              onAddToPlaylist(playlistId, menu.songIds);
              onClose();
            }}
          />
        ) : null}
      </div>
      {menu.source === "playlist" ? (
        <button
          type="button"
          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
          onClick={() => {
            onRemoveFromPlaylist(menu.songIds);
            onClose();
          }}
        >
          Remove from Playlist
        </button>
      ) : null}
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onCopy(menu.songIds);
          onClose();
        }}
      >
        Copy
      </button>
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onManageTags(menu.songIds);
          onClose();
        }}
      >
        Manage Tags
      </button>
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onEditComment(menu.songIds);
          onClose();
        }}
      >
        Edit Comment
      </button>
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/10"
        onClick={() => {
          onSetCustomStart(menu.songIds);
          onClose();
        }}
      >
        Set Custom Start Time
      </button>
    </div>
  );
}
