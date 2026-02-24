import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3, GripVertical, ListMusic, ListPlus, Trash2 } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useRef } from "react";
import { SongArtwork } from "../../components/song-artwork";
import { SongPlayButton } from "../../components/song-play-button";
import { Button } from "../../components/ui/button";
import {
  SONG_OPTIONAL_COLUMN_CONFIG,
  type SongOptionalColumnConfigItem,
} from "../../lib/song-columns";
import { cn } from "../../lib/utils";
import type {
  DragSongPayload,
  PlaylistNode,
  PlaylistTrackItem,
  SongOptionalColumnKey,
} from "../../types";

const TRACK_ROW_HEIGHT = 54;
const SCROLL_RESTORE_MAX_ATTEMPTS = 12;

interface PlaylistViewProps {
  playlist: PlaylistNode | null;
  tracks: Array<PlaylistTrackItem | undefined>;
  trackCount: number;
  visibleSongColumns: SongOptionalColumnKey[];
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
  initialScrollTop?: number;
  restoreScrollTop?: number | null;
  onScrollTopChange?: (scrollTop: number) => void;
}

interface TrackRowProps {
  playlistId: string;
  track: PlaylistTrackItem;
  index: number;
  visibleSongColumnConfigs: Array<{
    key: SongOptionalColumnKey;
    config: SongOptionalColumnConfigItem;
  }>;
  rowGridTemplateColumns: string;
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

function formatDateAdded(dateAdded: string | null) {
  if (!dateAdded) {
    return "—";
  }

  const parsed = new Date(dateAdded);
  if (Number.isNaN(parsed.getTime())) {
    return dateAdded;
  }

  return parsed.toLocaleDateString();
}

function TrackRow({
  playlistId,
  track,
  index,
  visibleSongColumnConfigs,
  rowGridTemplateColumns,
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
          "group/song grid w-full select-none items-center gap-3 px-3 py-2 text-left text-sm text-cloud",
          "hover:bg-cloud/8",
          selected && "bg-leaf/15",
          currentSongId === track.song.id && "border-l-2 border-l-blossom bg-blossom/20",
        )}
        style={{ gridTemplateColumns: rowGridTemplateColumns }}
        onClick={(event) =>
          onSelectTrack(track.song.id, index, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          })
        }
        onDoubleClick={() => onPlayTrack(index)}
        onContextMenu={(event) => onTrackContextMenu(event, track.song.id, index)}
      >
        <span className="flex items-center justify-center">
          {reorderEnabled ? (
            <GripVertical className="h-3.5 w-3.5 text-muted-on-dark" />
          ) : (
            <SongPlayButton onPlay={() => onPlayTrack(index)} label={`Play ${track.song.title}`} />
          )}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <SongArtwork artworkPath={track.song.artwork_path} />
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
        {visibleSongColumnConfigs.map(({ key: columnKey, config }) => {
          if (columnKey === "artist") {
            return (
              <span key={columnKey} className="truncate text-muted-on-dark">
                {track.song.artist}
              </span>
            );
          }
          if (columnKey === "album") {
            return (
              <span key={columnKey} className="truncate text-muted-on-dark">
                {track.song.album}
              </span>
            );
          }
          if (columnKey === "duration_ms") {
            return (
              <span key={columnKey} className="text-right text-muted-on-dark">
                {formatDuration(track.song.duration_ms)}
              </span>
            );
          }
          if (columnKey === "play_count") {
            return (
              <span key={columnKey} className="text-right text-muted-on-dark">
                {track.song.play_count}
              </span>
            );
          }
          if (columnKey === "comment") {
            const comment = track.song.comment?.trim() ?? "";
            return (
              <span
                key={columnKey}
                className="truncate text-muted-on-dark"
                title={comment || undefined}
              >
                {comment || "—"}
              </span>
            );
          }
          if (columnKey === "date_added") {
            return (
              <span
                key={columnKey}
                className={cn(
                  "text-muted-on-dark",
                  config.align === "right" ? "text-right" : "truncate",
                )}
              >
                {formatDateAdded(track.song.date_added)}
              </span>
            );
          }
          return null;
        })}
        <span className="flex justify-end">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-on-dark transition-colors hover:bg-cloud/10 hover:text-cloud"
            onClick={(event) => {
              event.stopPropagation();
              onAddToQueue(track.song.id);
            }}
            title="Add to queue"
          >
            <ListPlus className="h-4 w-4" />
          </button>
        </span>
      </button>
    </div>
  );
}

export function PlaylistView({
  playlist,
  tracks,
  trackCount,
  visibleSongColumns,
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
  initialScrollTop,
  restoreScrollTop,
  onScrollTopChange,
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
  const visibleSongColumnConfigs = useMemo(
    () =>
      visibleSongColumns.map((columnKey) => ({
        key: columnKey,
        config: SONG_OPTIONAL_COLUMN_CONFIG[columnKey],
      })),
    [visibleSongColumns],
  );
  const rowGridTemplateColumns = useMemo(
    () =>
      [
        "32px",
        "2fr",
        ...visibleSongColumnConfigs.map((column) => column.config.width),
        "46px",
      ].join(" "),
    [visibleSongColumnConfigs],
  );
  const rowLoadingColumnSpan = visibleSongColumns.length + 1;

  const firstVisibleIndex = virtualItems[0]?.index ?? 0;
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;

  useEffect(() => {
    if (!onRequestTrackRange || trackCount === 0) {
      return;
    }
    onRequestTrackRange(firstVisibleIndex, lastVisibleIndex);
  }, [firstVisibleIndex, lastVisibleIndex, onRequestTrackRange, trackCount]);

  useEffect(() => {
    if (!playlist) {
      return;
    }
    if (typeof initialScrollTop !== "number") {
      return;
    }
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = Math.max(0, initialScrollTop);
  }, [initialScrollTop, playlist]);

  useEffect(() => {
    if (!playlist) {
      return;
    }
    if (restoreScrollTop === null || restoreScrollTop === undefined) {
      return;
    }

    const targetScrollTop = Math.max(0, restoreScrollTop);
    let attempts = 0;
    let frame = 0;

    const applyRestore = () => {
      const element = scrollRef.current;
      if (!element) {
        return;
      }
      element.scrollTop = targetScrollTop;
      if (
        Math.abs(element.scrollTop - targetScrollTop) <= 1 ||
        attempts >= SCROLL_RESTORE_MAX_ATTEMPTS
      ) {
        return;
      }
      attempts += 1;
      frame = window.requestAnimationFrame(applyRestore);
    };

    applyRestore();

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [playlist, restoreScrollTop]);

  if (!playlist) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl bg-cloud/5">
        <p className="text-sm text-muted-on-dark">Select a playlist to view songs.</p>
      </div>
    );
  }

  const content = trackCount === 0 ? (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-on-dark">
      <ListMusic className="h-4 w-4" />
      Drop songs here or use paste.
    </div>
  ) : (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto"
      onScroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
    >
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
                  visibleSongColumnConfigs={visibleSongColumnConfigs}
                  rowGridTemplateColumns={rowGridTemplateColumns}
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
                <div
                  className="grid h-full w-full items-center gap-3 px-3 text-sm text-muted-on-dark"
                  style={{ gridTemplateColumns: rowGridTemplateColumns }}
                >
                  <span>{virtualRow.index + 1}</span>
                  <span
                    style={{
                      gridColumn: `span ${rowLoadingColumnSpan} / span ${rowLoadingColumnSpan}`,
                    }}
                  >
                    Loading...
                  </span>
                  <span />
                </div>
              )}
            </div>
          );
        })}
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

      <div
        className="grid gap-3 bg-cloud/8 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark"
        style={{ gridTemplateColumns: rowGridTemplateColumns }}
      >
        <span>#</span>
        <span>Title</span>
        {visibleSongColumnConfigs.map(({ key: columnKey, config }) => (
          <span key={columnKey} className={config.align === "right" ? "text-right" : "text-left"}>
            {config.label}
          </span>
        ))}
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
