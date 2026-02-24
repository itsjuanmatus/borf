import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Folder, FolderOpen, ListMusic } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { DragPlaylistPayload, PlaylistNode } from "../../types";

interface PlaylistTreeProps {
  playlists: PlaylistNode[];
  activePlaylistId: string | null;
  onSelectPlaylist: (playlistId: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, node: PlaylistNode) => void;
}

interface TreeNodeProps {
  node: PlaylistNode;
  depth: number;
  activePlaylistId: string | null;
  childrenByParent: Map<string | null, PlaylistNode[]>;
  expandedFolderIds: Set<string>;
  toggleFolder: (folderId: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, node: PlaylistNode) => void;
}

function TreeNode({
  node,
  depth,
  activePlaylistId,
  childrenByParent,
  expandedFolderIds,
  toggleFolder,
  onSelectPlaylist,
  onContextMenu,
}: TreeNodeProps) {
  const sortable = useSortable({
    id: `playlist-node:${node.id}`,
    data: {
      type: "playlist-node",
      playlistId: node.id,
      isFolder: node.is_folder,
    } satisfies DragPlaylistPayload,
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const childNodes = childrenByParent.get(node.id) ?? [];
  const isExpanded = node.is_folder ? expandedFolderIds.has(node.id) : false;

  return (
    <div ref={sortable.setNodeRef} style={style}>
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        className={cn(
          "mb-1 flex h-8 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted-on-dark",
          "hover:bg-cloud/8",
          sortable.isOver && "bg-leaf/15 ring-1 ring-leaf/50",
          activePlaylistId === node.id && "bg-leaf/20 text-cloud font-medium",
        )}
        data-playlist-id={node.id}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (node.is_folder) {
            toggleFolder(node.id);
            return;
          }
          onSelectPlaylist(node.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event, node);
        }}
      >
        {node.is_folder ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-on-dark" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-on-dark" />
          )
        ) : (
          <span className="h-3.5 w-3.5" />
        )}
        {node.is_folder ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-on-dark" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-muted-on-dark" />
          )
        ) : (
          <ListMusic className="h-4 w-4 shrink-0 text-muted-on-dark" />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {node.is_folder && isExpanded && childNodes.length > 0 ? (
        <SortableContext
          items={childNodes.map((child) => `playlist-node:${child.id}`)}
          strategy={verticalListSortingStrategy}
        >
          <div>
            {childNodes.map((childNode) => (
              <TreeNode
                key={childNode.id}
                node={childNode}
                depth={depth + 1}
                activePlaylistId={activePlaylistId}
                childrenByParent={childrenByParent}
                expandedFolderIds={expandedFolderIds}
                toggleFolder={toggleFolder}
                onSelectPlaylist={onSelectPlaylist}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        </SortableContext>
      ) : null}
    </div>
  );
}

export function PlaylistTree({
  playlists,
  activePlaylistId,
  onSelectPlaylist,
  onContextMenu,
}: PlaylistTreeProps) {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const treeRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpandedFolderIds((previous) => {
      if (previous.size > 0) {
        return previous;
      }
      const next = new Set(previous);
      for (const playlist of playlists) {
        if (playlist.is_folder) {
          next.add(playlist.id);
        }
      }
      return next;
    });
  }, [playlists]);

  const childrenByParent = useMemo(() => {
    const nextMap = new Map<string | null, PlaylistNode[]>();
    for (const playlist of playlists) {
      const parent = playlist.parent_id ?? null;
      const siblings = nextMap.get(parent) ?? [];
      siblings.push(playlist);
      nextMap.set(parent, siblings);
    }

    for (const siblings of nextMap.values()) {
      siblings.sort((a, b) => {
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return nextMap;
  }, [playlists]);
  const playlistById = useMemo(() => {
    const nextMap = new Map<string, PlaylistNode>();
    for (const playlist of playlists) {
      nextMap.set(playlist.id, playlist);
    }
    return nextMap;
  }, [playlists]);

  const rootNodes = childrenByParent.get(null) ?? [];
  const rootDroppable = useDroppable({ id: "playlist-root" });

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!activePlaylistId) {
      return;
    }

    setExpandedFolderIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      let cursor = playlistById.get(activePlaylistId) ?? null;

      while (cursor) {
        if (cursor.is_folder && !next.has(cursor.id)) {
          next.add(cursor.id);
          changed = true;
        }
        if (!cursor.parent_id) {
          break;
        }
        cursor = playlistById.get(cursor.parent_id) ?? null;
      }

      return changed ? next : previous;
    });
  }, [activePlaylistId, playlistById]);

  useEffect(() => {
    if (!activePlaylistId) {
      return;
    }

    let ancestor = playlistById.get(activePlaylistId) ?? null;
    while (ancestor?.parent_id) {
      const parent = playlistById.get(ancestor.parent_id) ?? null;
      if (!parent) {
        break;
      }
      if (parent.is_folder && !expandedFolderIds.has(parent.id)) {
        return;
      }
      ancestor = parent;
    }

    const treeRoot = treeRootRef.current;
    if (!treeRoot) {
      return;
    }

    const escapedPlaylistId = activePlaylistId.replace(/"/g, '\\"');
    const activeNode = treeRoot.querySelector<HTMLButtonElement>(
      `button[data-playlist-id="${escapedPlaylistId}"]`,
    );
    if (!activeNode) {
      return;
    }

    activeNode.scrollIntoView({ block: "nearest" });
  }, [activePlaylistId, expandedFolderIds, playlistById]);

  return (
    <div
      ref={(node) => {
        rootDroppable.setNodeRef(node);
        treeRootRef.current = node;
      }}
      className={cn(
        "min-h-16 rounded-lg p-1",
        rootDroppable.isOver && "bg-leaf/15 ring-1 ring-leaf/50",
      )}
    >
      <SortableContext
        items={rootNodes.map((node) => `playlist-node:${node.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {rootNodes.length === 0 ? (
          <p className="p-2 text-xs text-muted-on-dark">No playlists yet.</p>
        ) : (
          rootNodes.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              activePlaylistId={activePlaylistId}
              childrenByParent={childrenByParent}
              expandedFolderIds={expandedFolderIds}
              toggleFolder={toggleFolder}
              onSelectPlaylist={onSelectPlaylist}
              onContextMenu={onContextMenu}
            />
          ))
        )}
      </SortableContext>
    </div>
  );
}
