import { Clock3, ListPlus } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { SongArtwork } from "../../../components/song-artwork";
import { SongPlayButton } from "../../../components/song-play-button";
import type { SongOptionalColumnConfigItem } from "../../../lib/song-columns";
import { cn } from "../../../lib/utils";
import type { AlbumListItem, SongListItem, SongOptionalColumnKey } from "../../../types";
import { SongOptionalCells } from "../SongOptionalCells";
import { formatDuration } from "../song-format";

interface AlbumVirtualRow {
  key: string | number | bigint;
  index: number;
  start: number;
}

interface AlbumsViewProps {
  selectedAlbum: AlbumListItem | null;
  albumTracks: SongListItem[];
  loadingAlbumTracks: boolean;
  currentSongId: string | null;
  visibleSongColumnConfigs: Array<{
    key: SongOptionalColumnKey;
    config: SongOptionalColumnConfigItem;
  }>;
  compactSongGridTemplateColumnsWithAction: string;
  albumDetailScrollRef: RefObject<HTMLDivElement | null>;
  onAlbumDetailScrollTopChange: (scrollTop: number) => void;
  onPlayAlbumTrack: (index: number) => void;
  onAlbumTrackContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    song: SongListItem,
    index: number,
  ) => void;
  onAddSongToQueue: (songId: string) => void;
  albumsScrollRef: RefObject<HTMLDivElement | null>;
  onAlbumsListScrollTopChange: (scrollTop: number) => void;
  isLoadingAlbums: boolean;
  albums: AlbumListItem[];
  albumColumns: number;
  albumVirtualRows: AlbumVirtualRow[];
  albumVirtualTotalSize: number;
  onSelectAlbum: (album: AlbumListItem) => void;
}

export function AlbumsView({
  selectedAlbum,
  albumTracks,
  loadingAlbumTracks,
  currentSongId,
  visibleSongColumnConfigs,
  compactSongGridTemplateColumnsWithAction,
  albumDetailScrollRef,
  onAlbumDetailScrollTopChange,
  onPlayAlbumTrack,
  onAlbumTrackContextMenu,
  onAddSongToQueue,
  albumsScrollRef,
  onAlbumsListScrollTopChange,
  isLoadingAlbums,
  albums,
  albumColumns,
  albumVirtualRows,
  albumVirtualTotalSize,
  onSelectAlbum,
}: AlbumsViewProps) {
  return (
    <div className="h-full rounded-2xl bg-cloud/5 p-4">
      {selectedAlbum ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-4 flex items-center">
            <div>
              <h3 className="text-lg font-semibold text-cloud">{selectedAlbum.album}</h3>
              <p className="text-sm text-muted-on-dark">{selectedAlbum.album_artist}</p>
            </div>
          </div>

          <div
            ref={albumDetailScrollRef}
            className="min-h-0 flex-1 overflow-auto rounded-2xl bg-cloud/5"
            onScroll={(event) => onAlbumDetailScrollTopChange(event.currentTarget.scrollTop)}
          >
            <div
              className="sticky top-0 z-10 grid gap-3 bg-surface-dark/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark backdrop-blur-sm"
              style={{ gridTemplateColumns: compactSongGridTemplateColumnsWithAction }}
            >
              <span>#</span>
              <span>Title</span>
              {visibleSongColumnConfigs.map(({ key: columnKey, config }) => (
                <span
                  key={columnKey}
                  className={config.align === "right" ? "text-right" : "text-left"}
                >
                  {config.label}
                </span>
              ))}
              <span />
            </div>

            {loadingAlbumTracks ? (
              <p className="p-4 text-sm text-muted-on-dark">Loading album tracks...</p>
            ) : albumTracks.length === 0 ? (
              <p className="p-4 text-sm text-muted-on-dark">No tracks found for this album.</p>
            ) : (
              albumTracks.map((song, index) => (
                <button
                  key={song.id}
                  type="button"
                  className={cn(
                    "group/song grid w-full select-none items-center gap-3 px-3 py-2 text-left text-sm text-cloud",
                    "hover:bg-cloud/8",
                    currentSongId === song.id && "border-l-2 border-l-blossom bg-blossom/20",
                  )}
                  style={{ gridTemplateColumns: compactSongGridTemplateColumnsWithAction }}
                  onDoubleClick={() => onPlayAlbumTrack(index)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onAlbumTrackContextMenu(event, song, index);
                  }}
                >
                  <span className="flex items-center justify-center">
                    <SongPlayButton
                      onPlay={() => onPlayAlbumTrack(index)}
                      label={`Play ${song.title}`}
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
                  <span className="flex justify-end">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-on-dark transition-colors hover:bg-cloud/10 hover:text-cloud"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddSongToQueue(song.id);
                      }}
                      title="Add to queue"
                    >
                      <ListPlus className="h-4 w-4" />
                    </button>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div
          ref={albumsScrollRef}
          className="h-full overflow-auto"
          onScroll={(event) => onAlbumsListScrollTopChange(event.currentTarget.scrollTop)}
        >
          {isLoadingAlbums ? (
            <p className="text-sm text-muted-on-dark">Loading albums...</p>
          ) : (
            <div
              style={{
                height: `${albumVirtualTotalSize}px`,
                position: "relative",
              }}
            >
              {albumVirtualRows.map((virtualRow) => {
                const start = virtualRow.index * albumColumns;
                const rowAlbums = albums.slice(start, start + albumColumns);

                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="grid gap-4"
                  >
                    <div
                      className="grid gap-4"
                      style={{ gridTemplateColumns: `repeat(${albumColumns}, minmax(0, 1fr))` }}
                    >
                      {rowAlbums.map((album) => (
                        <button
                          key={`${album.album}-${album.album_artist}`}
                          type="button"
                          className="rounded-2xl bg-cloud/8 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-cloud/12"
                          onClick={() => onSelectAlbum(album)}
                        >
                          <SongArtwork
                            artworkPath={album.artwork_path}
                            className="mb-3"
                            sizeClassName="h-32 w-full"
                          />
                          <p className="truncate font-medium text-cloud">{album.album}</p>
                          <p className="truncate text-sm text-muted-on-dark">
                            {album.album_artist}
                          </p>
                          <p className="mt-1 text-xs text-muted-on-dark">
                            {album.song_count} songs • {formatDuration(album.total_duration_ms)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
