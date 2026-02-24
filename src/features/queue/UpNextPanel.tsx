import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { DragSongPayload, SongListItem } from "../../types";

interface UpNextPanelProps {
  nowPlaying: SongListItem | null;
  upNext: SongListItem[];
  playingFrom: SongListItem[];
  playingFromLabel: string | null;
  onClose: () => void;
  onRemoveUpNext: (songId: string) => void;
}

interface UpNextRowProps {
  song: SongListItem;
  index: number;
  onRemove: (songId: string) => void;
}

function UpNextRow({ song, index, onRemove }: UpNextRowProps) {
  const payload: DragSongPayload = {
    type: "song",
    songIds: [song.id],
    source: "queue",
  };
  const sortable = useSortable({ id: `queue-song:${song.id}`, data: payload });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className="rounded-md bg-cloud/8"
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <p className="w-6 text-xs text-muted-on-dark">{index + 1}</p>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-cloud">{song.title}</p>
          <p className="truncate text-xs text-muted-on-dark">{song.artist}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
          onClick={() => onRemove(song.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function UpNextPanel({
  nowPlaying,
  upNext,
  playingFrom,
  playingFromLabel,
  onClose,
  onRemoveUpNext,
}: UpNextPanelProps) {
  const queueDrop = useDroppable({ id: "queue-dropzone" });

  return (
    <div className="flex h-full flex-col bg-surface-dark">
      <header className="flex items-center justify-between border-b border-border-dark px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-cloud">Up Next</h3>
          <p className="text-xs text-muted-on-dark">Manual queue first</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-on-dark hover:text-cloud"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <section className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
            Now Playing
          </p>
          {nowPlaying ? (
            <div className="rounded-lg bg-cloud/8 p-3">
              <p className="truncate text-sm font-medium text-cloud">{nowPlaying.title}</p>
              <p className="truncate text-xs text-muted-on-dark">{nowPlaying.artist}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-on-dark">Nothing is currently playing.</p>
          )}
        </section>

        <section className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
            Up Next
          </p>
          <div
            ref={queueDrop.setNodeRef}
            className={cn(
              "space-y-2 rounded-lg p-2",
              queueDrop.isOver && "bg-leaf/15 ring-1 ring-leaf/50",
            )}
          >
            <SortableContext
              items={upNext.map((song) => `queue-song:${song.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {upNext.length === 0 ? (
                <p className="p-2 text-xs text-muted-on-dark">Drag songs here to queue manually.</p>
              ) : (
                upNext.map((song, index) => (
                  <UpNextRow key={song.id} song={song} index={index} onRemove={onRemoveUpNext} />
                ))
              )}
            </SortableContext>
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
            {playingFromLabel ? `Playing From ${playingFromLabel}` : "Playing From Source"}
          </p>
          <div className="space-y-1 rounded-lg bg-cloud/5 p-2">
            {playingFrom.length === 0 ? (
              <p className="p-2 text-xs text-muted-on-dark">No remaining source songs.</p>
            ) : (
              playingFrom.map((song) => (
                <div key={song.id} className="rounded-md px-2 py-1.5 text-sm">
                  <p className="truncate font-medium text-cloud">{song.title}</p>
                  <p className="truncate text-xs text-muted-on-dark">{song.artist}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
