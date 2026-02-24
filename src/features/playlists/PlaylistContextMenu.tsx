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
  const parentId = target?.is_folder ? target.id : (target?.parent_id ?? null);

  return (
    <div
      className="fixed z-50 w-52 rounded-2xl bg-cloud p-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-start rounded-xl hover:bg-sand/70"
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
        className="h-8 w-full justify-start rounded-xl hover:bg-sand/70"
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
            className="h-8 w-full justify-start rounded-xl hover:bg-sand/70"
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
              className="h-8 w-full justify-start rounded-xl hover:bg-sand/70"
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
              className="h-8 w-full justify-start rounded-xl hover:bg-sand/70"
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
            className="h-8 w-full justify-start rounded-xl text-red-700 hover:bg-sand/70 hover:text-red-700"
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
