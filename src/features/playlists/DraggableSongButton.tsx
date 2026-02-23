import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { DragSongPayload } from "../../types";

interface DraggableSongButtonProps {
  draggableId: string;
  payload: DragSongPayload;
  className: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLButtonElement>;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
}

export function DraggableSongButton({
  draggableId,
  payload,
  className,
  onClick,
  onDoubleClick,
  onContextMenu,
  children,
}: DraggableSongButtonProps) {
  const draggable = useDraggable({ id: draggableId, data: payload });

  return (
    <button
      ref={draggable.setNodeRef}
      type="button"
      className={className}
      style={{
        transform: CSS.Translate.toString(draggable.transform),
        opacity: draggable.isDragging ? 0.65 : 1,
      }}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </button>
  );
}
