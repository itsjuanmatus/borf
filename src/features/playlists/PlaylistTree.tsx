import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
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
  isDraggingNode: boolean;
  toggleFolder: (folderId: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, node: PlaylistNode) => void;
}

function InsertionGap({ id }: { id: string }) {
  const droppable = useDroppable({ id });

  return (
    <div ref={droppable.setNodeRef} className="flex h-3 items-center px-2">
      <div
        className={cn(
          "h-0.5 w-full rounded-full transition-colors",
          droppable.isOver ? "bg-leaf" : "bg-cloud/10",
        )}
      />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  activePlaylistId,
  childrenByParent,
  expandedFolderIds,
  isDraggingNode,
  toggleFolder,
  onSelectPlaylist,
  onContextMenu,
}: TreeNodeProps) {
  const dragPayload: DragPlaylistPayload = {
    type: "playlist-node",
    playlistId: node.id,
    isFolder: node.is_folder,
  };
  const draggable = useDraggable({
    id: `playlist-node:${node.id}`,
    data: dragPayload,
  });
  const droppable = useDroppable({
    id: `playlist-node:${node.id}`,
  });

  const { active } = useDndContext();
  const activeDragType = (active?.data.current as { type?: string } | undefined)?.type;
  const showDropHighlight = droppable.isOver && !(node.is_folder && activeDragType === "song");

  const childNodes = childrenByParent.get(node.id) ?? [];
  const isExpanded = node.is_folder ? expandedFolderIds.has(node.id) : false;

  return (
    <div>
      <button
        ref={(el) => {
          draggable.setNodeRef(el);
          droppable.setNodeRef(el);
        }}
        type="button"
        {...draggable.attributes}
        {...draggable.listeners}
        className={cn(
          "mb-1 flex h-8 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-muted-on-dark",
          "hover:bg-cloud/8",
          showDropHighlight && "bg-leaf/15 ring-1 ring-leaf/50",
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
        <div>
          {childNodes.map((childNode, i) => (
            <div key={childNode.id}>
              {isDraggingNode && i === 0 ? <InsertionGap id={`playlist-gap:${node.id}:0`} /> : null}
              <TreeNode
                node={childNode}
                depth={depth + 1}
                activePlaylistId={activePlaylistId}
                childrenByParent={childrenByParent}
                expandedFolderIds={expandedFolderIds}
                isDraggingNode={isDraggingNode}
                toggleFolder={toggleFolder}
                onSelectPlaylist={onSelectPlaylist}
                onContextMenu={onContextMenu}
              />
              {isDraggingNode ? <InsertionGap id={`playlist-gap:${node.id}:${i + 1}`} /> : null}
            </div>
          ))}
        </div>
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
  const expandedFolderIdsRef = useRef(expandedFolderIds);
  expandedFolderIdsRef.current = expandedFolderIds;

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
      if (parent.is_folder && !expandedFolderIdsRef.current.has(parent.id)) {
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
  }, [activePlaylistId, playlistById]);

  const { active } = useDndContext();
  const activeDragType = (active?.data.current as { type?: string } | undefined)?.type;
  const isDraggingNode = activeDragType === "playlist-node";

  return (
    <div ref={treeRootRef} className="min-h-16 rounded-lg p-1">
      {rootNodes.length === 0 ? (
        <p className="p-2 text-xs text-muted-on-dark">No playlists yet.</p>
      ) : (
        rootNodes.map((node, i) => (
          <div key={node.id}>
            {isDraggingNode && i === 0 ? <InsertionGap id="playlist-gap:root:0" /> : null}
            <TreeNode
              node={node}
              depth={0}
              activePlaylistId={activePlaylistId}
              childrenByParent={childrenByParent}
              expandedFolderIds={expandedFolderIds}
              isDraggingNode={isDraggingNode}
              toggleFolder={toggleFolder}
              onSelectPlaylist={onSelectPlaylist}
              onContextMenu={onContextMenu}
            />
            {isDraggingNode ? <InsertionGap id={`playlist-gap:root:${i + 1}`} /> : null}
          </div>
        ))
      )}
    </div>
  );
}
