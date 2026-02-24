import type { SongOptionalColumnConfigItem } from "../../lib/song-columns";
import { cn } from "../../lib/utils";
import type { SongListItem, SongOptionalColumnKey } from "../../types";
import { formatDateAdded, formatDuration } from "./song-format";

interface SongOptionalCellsProps {
  song: SongListItem;
  visibleSongColumnConfigs: Array<{
    key: SongOptionalColumnKey;
    config: SongOptionalColumnConfigItem;
  }>;
}

export function SongOptionalCells({ song, visibleSongColumnConfigs }: SongOptionalCellsProps) {
  return visibleSongColumnConfigs.map(({ key: columnKey, config }) => {
    if (columnKey === "artist") {
      return (
        <span key={columnKey} className="truncate text-muted-on-dark">
          {song.artist}
        </span>
      );
    }

    if (columnKey === "album") {
      return (
        <span key={columnKey} className="truncate text-muted-on-dark">
          {song.album}
        </span>
      );
    }

    if (columnKey === "duration_ms") {
      return (
        <span key={columnKey} className="text-right text-muted-on-dark">
          {formatDuration(song.duration_ms)}
        </span>
      );
    }

    if (columnKey === "play_count") {
      return (
        <span key={columnKey} className="text-right text-muted-on-dark">
          {song.play_count}
        </span>
      );
    }

    if (columnKey === "comment") {
      const comment = song.comment?.trim() ?? "";
      return (
        <span key={columnKey} className="truncate text-muted-on-dark" title={comment || undefined}>
          {comment || "—"}
        </span>
      );
    }

    if (columnKey === "date_added") {
      return (
        <span
          key={columnKey}
          className={cn("text-muted-on-dark", config.align === "right" ? "text-right" : "truncate")}
        >
          {formatDateAdded(song.date_added)}
        </span>
      );
    }

    return null;
  });
}
