import type { RefObject } from "react";

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
  onPlayFromHere: (source: SongContextMenuState["source"], index: number) => void;
  onAddToQueue: (songIds: string[]) => void;
  onCopy: (songIds: string[]) => void;
  onManageTags: (songIds: string[]) => void;
  onEditComment: (songIds: string[]) => void;
  onSetCustomStart: (songIds: string[]) => void;
  onClose: () => void;
}

export function SongContextMenu({
  menu,
  menuRef,
  position,
  onPlayFromHere,
  onAddToQueue,
  onCopy,
  onManageTags,
  onEditComment,
  onSetCustomStart,
  onClose,
}: SongContextMenuProps) {
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
