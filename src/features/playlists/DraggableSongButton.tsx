import { useDraggable } from "@dnd-kit/core";
import type { DragSongPayload } from "../../types";

interface DraggableSongButtonProps {
  draggableId: string;
  payload: DragSongPayload & Record<string, unknown>;
  className: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLButtonElement>;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
}

export function DraggableSongButton({
  draggableId,
  payload,
  className,
  style,
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
        ...style,
        opacity: draggable.isDragging ? 0.4 : 1,
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
