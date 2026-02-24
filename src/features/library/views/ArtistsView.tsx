import { Clock3, ListPlus, UserRound } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { SongArtwork } from "../../../components/song-artwork";
import { SongPlayButton } from "../../../components/song-play-button";
import type { SongOptionalColumnConfigItem } from "../../../lib/song-columns";
import { cn } from "../../../lib/utils";
import type {
  AlbumListItem,
  ArtistListItem,
  SongListItem,
  SongOptionalColumnKey,
} from "../../../types";
import { SongOptionalCells } from "../SongOptionalCells";
import { formatDuration } from "../song-format";

interface ArtistVirtualRow {
  key: string | number | bigint;
  index: number;
  size: number;
  start: number;
}

interface ArtistsViewProps {
  selectedArtist: string | null;
  artistsScrollRef: RefObject<HTMLDivElement | null>;
  onArtistsListScrollTopChange: (scrollTop: number) => void;
  isLoadingArtists: boolean;
  artists: ArtistListItem[];
  artistVirtualRows: ArtistVirtualRow[];
  artistVirtualTotalSize: number;
  onSelectArtist: (artist: string) => void;
  artistAlbums: AlbumListItem[];
  selectedArtistAlbum: AlbumListItem | null;
  loadingArtistAlbums: boolean;
  loadingArtistAlbumTracks: boolean;
  artistAlbumTracks: SongListItem[];
  artistAlbumsScrollRef: RefObject<HTMLDivElement | null>;
  onArtistAlbumsScrollTopChange: (scrollTop: number) => void;
  artistAlbumTracksScrollRef: RefObject<HTMLDivElement | null>;
  onArtistAlbumTracksScrollTopChange: (scrollTop: number) => void;
  visibleSongColumnConfigs: Array<{
    key: SongOptionalColumnKey;
    config: SongOptionalColumnConfigItem;
  }>;
  compactSongGridTemplateColumnsWithAction: string;
  currentSongId: string | null;
  onSelectArtistAlbum: (album: AlbumListItem) => void;
  onPlayArtistAlbumTrack: (index: number) => void;
  onArtistAlbumTrackContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    song: SongListItem,
    index: number,
  ) => void;
  onAddSongToQueue: (songId: string) => void;
}

export function ArtistsView({
  selectedArtist,
  artistsScrollRef,
  onArtistsListScrollTopChange,
  isLoadingArtists,
  artists,
  artistVirtualRows,
  artistVirtualTotalSize,
  onSelectArtist,
  artistAlbums,
  selectedArtistAlbum,
  loadingArtistAlbums,
  loadingArtistAlbumTracks,
  artistAlbumTracks,
  artistAlbumsScrollRef,
  onArtistAlbumsScrollTopChange,
  artistAlbumTracksScrollRef,
  onArtistAlbumTracksScrollTopChange,
  visibleSongColumnConfigs,
  compactSongGridTemplateColumnsWithAction,
  currentSongId,
  onSelectArtistAlbum,
  onPlayArtistAlbumTrack,
  onArtistAlbumTrackContextMenu,
  onAddSongToQueue,
}: ArtistsViewProps) {
  return (
    <div className="h-full rounded-2xl bg-cloud/5 p-4">
      {!selectedArtist ? (
        <div
          ref={artistsScrollRef}
          className="h-full overflow-auto rounded-2xl"
          onScroll={(event) => onArtistsListScrollTopChange(event.currentTarget.scrollTop)}
        >
          <div className="sticky top-0 z-10 grid grid-cols-[40px_2fr_100px_100px] items-center gap-3 bg-surface-dark/90 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-on-dark backdrop-blur-sm">
            <span />
            <span>Artist</span>
            <span className="text-right">Albums</span>
            <span className="text-right">Songs</span>
          </div>
          {isLoadingArtists ? (
            <p className="p-4 text-sm text-muted-on-dark">Loading artists...</p>
          ) : (
            <div
              style={{
                height: `${artistVirtualTotalSize}px`,
                position: "relative",
              }}
            >
              {artistVirtualRows.map((virtualRow) => {
                const artist = artists[virtualRow.index];
                if (!artist) {
                  return null;
                }

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
                    <button
                      type="button"
                      className="grid h-full w-full grid-cols-[40px_2fr_100px_100px] items-center gap-3 rounded-xl px-3 text-left text-sm text-cloud transition-colors hover:bg-cloud/8"
                      onClick={() => onSelectArtist(artist.artist)}
                    >
                      {artist.artwork_path ? (
                        <SongArtwork artworkPath={artist.artwork_path} sizeClassName="h-8 w-8" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cloud/10 text-sm font-semibold text-muted-on-dark">
                          {artist.artist.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="truncate font-medium">{artist.artist}</span>
                      <span className="text-right text-muted-on-dark">{artist.album_count}</span>
                      <span className="text-right text-muted-on-dark">{artist.song_count}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-5 flex items-center gap-4">
            {artistAlbums.length > 0 && artistAlbums[0]?.artwork_path ? (
              <SongArtwork
                artworkPath={artistAlbums[0].artwork_path}
                sizeClassName="h-20 w-20"
                className="shrink-0 rounded-2xl"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-cloud/10">
                <UserRound className="h-8 w-8 text-muted-on-dark" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-2xl font-bold tracking-tight text-cloud">
                {selectedArtist}
              </h3>
              <div className="mt-1 flex gap-3 text-sm text-muted-on-dark">
                <span>
                  {artistAlbums.length} {artistAlbums.length === 1 ? "album" : "albums"}
                </span>
                <span className="text-cloud/20">|</span>
                <span>{artistAlbums.reduce((sum, a) => sum + a.song_count, 0)} songs</span>
                <span className="text-cloud/20">|</span>
                <span>
                  {formatDuration(artistAlbums.reduce((sum, a) => sum + a.total_duration_ms, 0))}
                </span>
              </div>
            </div>
          </div>

          {!selectedArtistAlbum ? (
            <div
              ref={artistAlbumsScrollRef}
              className="min-h-0 flex-1 overflow-auto rounded-2xl p-3"
              onScroll={(event) => onArtistAlbumsScrollTopChange(event.currentTarget.scrollTop)}
            >
              {loadingArtistAlbums ? (
                <p className="text-sm text-muted-on-dark">Loading albums...</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {artistAlbums.map((album) => (
                    <button
                      key={`${album.album}-${album.album_artist}`}
                      type="button"
                      className="rounded-2xl bg-cloud/8 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-cloud/12"
                      onClick={() => onSelectArtistAlbum(album)}
                    >
                      <SongArtwork
                        artworkPath={album.artwork_path}
                        className="mb-3"
                        sizeClassName="h-32 w-full"
                      />
                      <p className="truncate font-medium text-cloud">{album.album}</p>
                      <p className="mt-1 text-xs text-muted-on-dark">
                        {album.song_count} songs • {formatDuration(album.total_duration_ms)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              ref={artistAlbumTracksScrollRef}
              className="min-h-0 flex-1 overflow-auto rounded-2xl bg-cloud/5"
              onScroll={(event) =>
                onArtistAlbumTracksScrollTopChange(event.currentTarget.scrollTop)
              }
            >
              <div className="flex items-center gap-4 px-4 py-4">
                <SongArtwork
                  artworkPath={selectedArtistAlbum.artwork_path}
                  sizeClassName="h-16 w-16"
                  className="shrink-0 rounded-xl"
                />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-cloud">
                    {selectedArtistAlbum.album}
                  </p>
                  <p className="truncate text-sm text-muted-on-dark">
                    {selectedArtistAlbum.album_artist}
                    {selectedArtistAlbum.year ? ` • ${selectedArtistAlbum.year}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-on-dark">
                    {selectedArtistAlbum.song_count}{" "}
                    {selectedArtistAlbum.song_count === 1 ? "track" : "tracks"} •{" "}
                    {formatDuration(selectedArtistAlbum.total_duration_ms)}
                  </p>
                </div>
              </div>

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

              {loadingArtistAlbumTracks ? (
                <p className="p-4 text-sm text-muted-on-dark">Loading tracks...</p>
              ) : (
                artistAlbumTracks.map((song, index) => (
                  <button
                    key={song.id}
                    type="button"
                    className={cn(
                      "group/song grid w-full select-none items-center gap-3 px-3 py-2 text-left text-sm text-cloud",
                      "hover:bg-cloud/8",
                      currentSongId === song.id && "border-l-2 border-l-blossom bg-blossom/20",
                    )}
                    style={{ gridTemplateColumns: compactSongGridTemplateColumnsWithAction }}
                    onDoubleClick={() => onPlayArtistAlbumTrack(index)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onArtistAlbumTrackContextMenu(event, song, index);
                    }}
                  >
                    <span className="flex items-center justify-center">
                      <span className="text-muted-on-dark group-hover/song:hidden">{index + 1}</span>
                      <SongPlayButton
                        onPlay={() => onPlayArtistAlbumTrack(index)}
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
          )}
        </div>
      )}
    </div>
  );
}
