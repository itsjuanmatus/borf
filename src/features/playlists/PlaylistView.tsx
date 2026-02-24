import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3, GripVertical, ListMusic, Plus, Trash2 } from "lucide-react";
import { type MouseEvent, useEffect, useRef } from "react";
import { SongArtwork } from "../../components/song-artwork";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { DragSongPayload, PlaylistNode, PlaylistTrackItem } from "../../types";

const TRACK_ROW_HEIGHT = 54;

interface PlaylistViewProps {
  playlist: PlaylistNode | null;
  tracks: Array<PlaylistTrackItem | undefined>;
  trackCount: number;
  currentSongId: string | null;
  selectedSongIds: string[];
  selectedSongIdSet: Set<string>;
  isReorderMode: boolean;
  canReorder: boolean;
  onToggleReorderMode: () => void;
  onRequestTrackRange?: (startIndex: number, endIndex: number) => void;
  onSelectTrack: (
    songId: string,
    index: number,
    modifiers: { shiftKey: boolean; metaKey: boolean },
  ) => void;
  onPlayTrack: (index: number) => void;
  onAddToQueue: (songId: string) => void;
  onRemoveSelected: () => void;
  onTrackContextMenu: (event: MouseEvent<HTMLButtonElement>, songId: string, index: number) => void;
}

interface TrackRowProps {
  playlistId: string;
  track: PlaylistTrackItem;
  index: number;
  selectedSongIds: string[];
  selectedSongIdSet: Set<string>;
  currentSongId: string | null;
  reorderEnabled: boolean;
  onSelectTrack: (
    songId: string,
    index: number,
    modifiers: { shiftKey: boolean; metaKey: boolean },
  ) => void;
  onPlayTrack: (index: number) => void;
  onAddToQueue: (songId: string) => void;
  onTrackContextMenu: (event: MouseEvent<HTMLButtonElement>, songId: string, index: number) => void;
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
  selectedSongIdSet,
  currentSongId,
  reorderEnabled,
  onSelectTrack,
  onPlayTrack,
  onAddToQueue,
  onTrackContextMenu,
}: TrackRowProps) {
  const selected = selectedSongIdSet.has(track.song.id);
  const payload: DragSongPayload = {
    type: "song",
    songIds: selected ? selectedSongIds : [track.song.id],
    source: "playlist",
    fromPlaylistId: playlistId,
  };

  const sortable = useSortable({
    id: `playlist-track:${track.song.id}`,
    data: payload,
    disabled: !reorderEnabled,
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
        {...(reorderEnabled ? sortable.attributes : {})}
        {...(reorderEnabled ? sortable.listeners : {})}
        className={cn(
          "group/song grid w-full select-none grid-cols-[32px_2fr_1.3fr_110px_46px] items-center gap-3 px-3 py-2 text-left text-sm text-cloud",
          "hover:bg-cloud/8",
          selected && "bg-leaf/15",
          currentSongId === track.song.id && "border-l-2 border-l-blossom bg-blossom/20",
        )}
        onClick={(event) =>
          onSelectTrack(track.song.id, index, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          })
        }
        onDoubleClick={() => onPlayTrack(index)}
        onContextMenu={(event) => onTrackContextMenu(event, track.song.id, index)}
      >
        <span className="flex items-center gap-1 text-xs text-muted-on-dark">
          {reorderEnabled ? <GripVertical className="h-3.5 w-3.5" /> : null}
          {index + 1}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <SongArtwork
            artworkPath={track.song.artwork_path}
            playLabel={`Play ${track.song.title}`}
            onPlay={() => onPlayTrack(index)}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{track.song.title}</span>
              {track.song.custom_start_ms > 0 ? (
                <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-on-dark" />
              ) : null}
            </div>
            {track.song.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {track.song.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full border border-cloud/20 px-1.5 py-0.5 text-[10px] leading-none text-cloud"
                    style={{ backgroundColor: `${tag.color}40` }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <span className="truncate text-muted-on-dark">{track.song.artist}</span>
        <span className="text-right text-muted-on-dark">{formatDuration(track.song.duration_ms)}</span>
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
  trackCount,
  currentSongId,
  selectedSongIds,
  selectedSongIdSet,
  isReorderMode,
  canReorder,
  onToggleReorderMode,
  onRequestTrackRange,
  onSelectTrack,
  onPlayTrack,
  onAddToQueue,
  onRemoveSelected,
  onTrackContextMenu,
}: PlaylistViewProps) {
  const droppable = useDroppable({
    id: playlist ? `playlist-tracks-drop:${playlist.id}` : "playlist-tracks-drop:none",
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: trackCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TRACK_ROW_HEIGHT,
    overscan: 16,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const firstVisibleIndex = virtualItems[0]?.index ?? 0;
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  useEffect(() => {
    if (!onRequestTrackRange || trackCount === 0) {
      return;
    }
    onRequestTrackRange(firstVisibleIndex, lastVisibleIndex);
  }, [firstVisibleIndex, lastVisibleIndex, onRequestTrackRange, trackCount]);

  if (!playlist) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl bg-cloud/5">
        <p className="text-sm text-muted-on-dark">Select a playlist to view songs.</p>
      </div>
    );
  }

  const content = (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const track = tracks[virtualRow.index];

          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {track ? (
                <TrackRow
                  playlistId={playlist.id}
                  track={track}
                  index={virtualRow.index}
                  selectedSongIds={selectedSongIds}
                  selectedSongIdSet={selectedSongIdSet}
                  currentSongId={currentSongId}
                  reorderEnabled={isReorderMode && canReorder}
                  onSelectTrack={onSelectTrack}
                  onPlayTrack={onPlayTrack}
                  onAddToQueue={onAddToQueue}
                  onTrackContextMenu={onTrackContextMenu}
                />
              ) : (
                <div className="grid h-full w-full grid-cols-[32px_2fr_1.3fr_110px_46px] items-center gap-3 px-3 text-sm text-muted-on-dark">
                  <span>{virtualRow.index + 1}</span>
                  <span>Loading...</span>
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          );
        })}

        {trackCount === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-on-dark">
            <ListMusic className="h-4 w-4" />
            Drop songs here or use paste.
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      ref={droppable.setNodeRef}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl bg-cloud/5",
        droppable.isOver && "ring-1 ring-leaf",
      )}
    >
      <header className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-cloud">{playlist.name}</h3>
          <p className="text-xs text-muted-on-dark">{trackCount.toLocaleString()} songs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onToggleReorderMode}>
            {isReorderMode ? "Done" : "Edit Order"}
          </Button>
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

      <div className="grid grid-cols-[32px_2fr_1.3fr_110px_46px] gap-3 bg-cloud/8 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
        <span>#</span>
        <span>Title</span>
        <span>Artist</span>
        <span className="text-right">Duration</span>
        <span />
      </div>

      {isReorderMode && canReorder ? (
        <SortableContext
          items={tracks
            .filter((track): track is PlaylistTrackItem => Boolean(track))
            .map((track) => `playlist-track:${track.song.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {content}
        </SortableContext>
      ) : (
        content
      )}

      {isReorderMode && !canReorder ? (
        <div className="px-3 py-2 text-xs text-muted-on-dark">
          Loading full playlist before reordering...
        </div>
      ) : null}
    </div>
  );
}
