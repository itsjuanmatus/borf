import { Clock3 } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { SongArtwork } from "../../../components/song-artwork";
import { SongPlayButton } from "../../../components/song-play-button";
import type { SongOptionalColumnConfigItem } from "../../../lib/song-columns";
import { cn } from "../../../lib/utils";
import type { SongListItem, SongOptionalColumnKey, SongSortField, SortOrder } from "../../../types";
import { DraggableSongButton } from "../../playlists/DraggableSongButton";
import { SongOptionalCells } from "../SongOptionalCells";

interface SongVirtualRow {
  key: string | number | bigint;
  index: number;
  size: number;
  start: number;
}

interface SongsViewProps {
  songGridTemplateColumns: string;
  songSort: SongSortField;
  songOrder: SortOrder;
  visibleSongColumnConfigs: Array<{
    key: SongOptionalColumnKey;
    config: SongOptionalColumnConfigItem;
  }>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollTopChange: (scrollTop: number) => void;
  songVirtualRows: SongVirtualRow[];
  songVirtualTotalSize: number;
  songsByIndex: Record<number, SongListItem>;
  selectedSongIds: string[];
  selectedSongIdSet: Set<string>;
  currentSongId: string | null;
  songLoadingColumnSpan: number;
  songCount: number;
  onSortClick: (field: SongSortField) => void;
  onSongClick: (
    song: SongListItem,
    index: number,
    modifiers: { shiftKey: boolean; metaKey: boolean },
  ) => void;
  onSongContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    song: SongListItem,
    index: number,
  ) => void;
  onPlayFromIndex: (index: number) => void;
}

export function SongsView({
  songGridTemplateColumns,
  songSort,
  songOrder,
  visibleSongColumnConfigs,
  scrollRef,
  onScrollTopChange,
  songVirtualRows,
  songVirtualTotalSize,
  songsByIndex,
  selectedSongIds,
  selectedSongIdSet,
  currentSongId,
  songLoadingColumnSpan,
  songCount,
  onSortClick,
  onSongClick,
  onSongContextMenu,
  onPlayFromIndex,
}: SongsViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl bg-cloud/5">
      <div
        className="grid gap-3 rounded-t-2xl bg-cloud/8 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark"
        style={{ gridTemplateColumns: songGridTemplateColumns }}
      >
        <span>#</span>
        <button type="button" className="text-left" onClick={() => onSortClick("title")}>
          Title {songSort === "title" ? (songOrder === "asc" ? "↑" : "↓") : ""}
        </button>
        {visibleSongColumnConfigs.map(({ key: columnKey, config }) => {
          const alignmentClass = config.align === "right" ? "text-right" : "text-left";
          const sortField = config.sortField;
          if (!sortField) {
            return (
              <span key={columnKey} className={alignmentClass}>
                {config.label}
              </span>
            );
          }
          return (
            <button
              key={columnKey}
              type="button"
              className={alignmentClass}
              onClick={() => onSortClick(sortField)}
            >
              {config.label} {songSort === sortField ? (songOrder === "asc" ? "↑" : "↓") : ""}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
      >
        <div
          style={{
            height: `${songVirtualTotalSize}px`,
            position: "relative",
          }}
        >
          {songVirtualRows.map((virtualRow) => {
            const song = songsByIndex[virtualRow.index];
            const isSelected = song ? selectedSongIdSet.has(song.id) : false;
            const isActive = currentSongId === song?.id;

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
                <DraggableSongButton
                  draggableId={
                    song ? `library-song:${song.id}` : `library-loading:${virtualRow.index}`
                  }
                  payload={{
                    type: "song",
                    songIds:
                      song && selectedSongIdSet.has(song.id)
                        ? selectedSongIds
                        : song
                          ? [song.id]
                          : [],
                    source: "library",
                  }}
                  onClick={(event) => {
                    if (!song) {
                      return;
                    }
                    onSongClick(song, virtualRow.index, {
                      shiftKey: event.shiftKey,
                      metaKey: event.metaKey,
                    });
                  }}
                  onDoubleClick={() => {
                    if (!song) {
                      return;
                    }
                    onPlayFromIndex(virtualRow.index);
                  }}
                  onContextMenu={(event) => {
                    if (!song) {
                      return;
                    }
                    event.preventDefault();
                    onSongContextMenu(event, song, virtualRow.index);
                  }}
                  className={cn(
                    "group/song grid h-full w-full select-none items-center gap-3 px-3 text-left text-sm text-cloud transition-colors",
                    "hover:bg-cloud/8",
                    isSelected && "bg-leaf/15",
                    isActive && "border-l-2 border-l-blossom bg-blossom/20",
                  )}
                  style={{ gridTemplateColumns: songGridTemplateColumns }}
                >
                  {song ? (
                    <>
                      <span className="flex items-center justify-center">
                        <span className="text-muted-on-dark group-hover/song:hidden">
                          {virtualRow.index + 1}
                        </span>
                        <SongPlayButton
                          onPlay={() => {
                            onPlayFromIndex(virtualRow.index);
                          }}
                          label={`Play ${song.title}`}
                          className="hidden group-hover/song:flex"
                        />
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        <SongArtwork artworkPath={song.artwork_path} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{song.title}</span>
                            {song.custom_start_ms > 0 ? (
                              <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-on-dark" />
                            ) : null}
                          </div>
                          {song.tags.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {song.tags.slice(0, 3).map((tag) => (
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
                      <SongOptionalCells
                        song={song}
                        visibleSongColumnConfigs={visibleSongColumnConfigs}
                      />
                    </>
                  ) : (
                    <>
                      <span className="text-muted-on-dark">{virtualRow.index + 1}</span>
                      <span
                        className="text-muted-on-dark"
                        style={{
                          gridColumn: `span ${songLoadingColumnSpan} / span ${songLoadingColumnSpan}`,
                        }}
                      >
                        Loading...
                      </span>
                    </>
                  )}
                </DraggableSongButton>
              </div>
            );
          })}

          {songCount === 0 ? (
            <p className="p-6 text-sm text-muted-on-dark">No songs to display yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
