import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListMusic, Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { DragSongPayload, PlaylistNode, PlaylistTrackItem } from "../../types";

interface PlaylistViewProps {
  playlist: PlaylistNode | null;
  tracks: PlaylistTrackItem[];
  currentSongId: string | null;
  selectedSongIds: string[];
  onSelectTrack: (
    songId: string,
    index: number,
    modifiers: { shiftKey: boolean; metaKey: boolean },
  ) => void;
  onPlayTrack: (index: number) => void;
  onAddToQueue: (songId: string) => void;
  onRemoveSelected: () => void;
}

interface TrackRowProps {
  playlistId: string;
  track: PlaylistTrackItem;
  index: number;
  selectedSongIds: string[];
  currentSongId: string | null;
  onSelectTrack: (
    songId: string,
    index: number,
    modifiers: { shiftKey: boolean; metaKey: boolean },
  ) => void;
  onPlayTrack: (index: number) => void;
  onAddToQueue: (songId: string) => void;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function TrackRow({
  playlistId,
  track,
  index,
  selectedSongIds,
  currentSongId,
  onSelectTrack,
  onPlayTrack,
  onAddToQueue,
}: TrackRowProps) {
  const selected = selectedSongIds.includes(track.song.id);
  const payload: DragSongPayload = {
    type: "song",
    songIds: selected ? selectedSongIds : [track.song.id],
    source: "playlist",
    fromPlaylistId: playlistId,
  };

  const sortable = useSortable({
    id: `playlist-track:${track.song.id}`,
    data: payload,
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        className={cn(
          "grid w-full grid-cols-[36px_2fr_1.3fr_110px_46px] items-center gap-3 border-b border-border/60 px-3 py-2 text-left text-sm",
          "hover:bg-sky/15",
          selected && "bg-sky/20",
          currentSongId === track.song.id && "bg-blossom/25",
        )}
        onClick={(event) =>
          onSelectTrack(track.song.id, index, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          })
        }
        onDoubleClick={() => onPlayTrack(index)}
      >
        <span className="text-xs text-muted">{index + 1}</span>
        <span className="truncate font-medium">{track.song.title}</span>
        <span className="truncate text-muted">{track.song.artist}</span>
        <span className="text-right text-muted">{formatDuration(track.song.duration_ms)}</span>
        <span className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-7 w-7"
            onClick={(event) => {
              event.stopPropagation();
              onAddToQueue(track.song.id);
            }}
            title="Add to queue"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </span>
      </button>
    </div>
  );
}

export function PlaylistView({
  playlist,
  tracks,
  currentSongId,
  selectedSongIds,
  onSelectTrack,
  onPlayTrack,
  onAddToQueue,
  onRemoveSelected,
}: PlaylistViewProps) {
  const droppable = useDroppable({
    id: playlist ? `playlist-tracks-drop:${playlist.id}` : "playlist-tracks-drop:none",
  });

  if (!playlist) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-white">
        <p className="text-sm text-muted">Select a playlist to view songs.</p>
      </div>
    );
  }

  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-border bg-white",
        droppable.isOver && "ring-1 ring-sky",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{playlist.name}</h3>
          <p className="text-xs text-muted">{tracks.length.toLocaleString()} songs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRemoveSelected}
            disabled={selectedSongIds.length === 0}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Remove Selected
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-[36px_2fr_1.3fr_110px_46px] gap-3 border-b border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span>#</span>
        <span>Title</span>
        <span>Artist</span>
        <span className="text-right">Duration</span>
        <span />
      </div>

      <SortableContext
        items={tracks.map((track) => `playlist-track:${track.song.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          {tracks.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
              <ListMusic className="h-4 w-4" />
              Drop songs here or use paste.
            </div>
          ) : (
            tracks.map((track, index) => (
              <TrackRow
                key={track.song.id}
                playlistId={playlist.id}
                track={track}
                index={index}
                selectedSongIds={selectedSongIds}
                currentSongId={currentSongId}
                onSelectTrack={onSelectTrack}
                onPlayTrack={onPlayTrack}
                onAddToQueue={onAddToQueue}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
