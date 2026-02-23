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
}: PlaylistContextMenuProps) {
  const parentId = target?.is_folder ? target.id : (target?.parent_id ?? null);

  return (
    <div
      className="fixed z-50 w-52 rounded-lg border border-border bg-white p-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-start"
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
        className="h-8 w-full justify-start"
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
            className="h-8 w-full justify-start"
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
              className="h-8 w-full justify-start"
              onClick={() => {
                onDuplicate(target);
                onClose();
              }}
            >
              Duplicate
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start text-red-700 hover:text-red-700"
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
