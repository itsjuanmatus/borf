import type { SongOptionalColumnKey, SongSortField } from "../types";

export interface SongOptionalColumnConfigItem {
  label: string;
  width: string;
  align: "left" | "right";
  sortField?: SongSortField;
}

export const SONG_OPTIONAL_COLUMN_ORDER: SongOptionalColumnKey[] = [
  "artist",
  "album",
  "duration_ms",
  "play_count",
  "comment",
  "date_added",
];

export const DEFAULT_SONG_COLUMN_ORDER: SongOptionalColumnKey[] = [...SONG_OPTIONAL_COLUMN_ORDER];

export const DEFAULT_VISIBLE_SONG_COLUMNS: SongOptionalColumnKey[] = [
  "artist",
  "album",
  "duration_ms",
  "play_count",
];

export const SONG_OPTIONAL_COLUMN_CONFIG: Record<
  SongOptionalColumnKey,
  SongOptionalColumnConfigItem
> = {
  artist: {
    label: "Artist",
    width: "1.6fr",
    align: "left",
    sortField: "artist",
  },
  album: {
    label: "Album",
    width: "1.6fr",
    align: "left",
    sortField: "album",
  },
  duration_ms: {
    label: "Duration",
    width: "120px",
    align: "right",
    sortField: "duration_ms",
  },
  play_count: {
    label: "Plays",
    width: "90px",
    align: "right",
    sortField: "play_count",
  },
  comment: {
    label: "Comment",
    width: "1.8fr",
    align: "left",
  },
  date_added: {
    label: "Date Added",
    width: "130px",
    align: "right",
    sortField: "date_added",
  },
};

export function normalizeSongVisibleColumns(
  values: ReadonlyArray<string | SongOptionalColumnKey>,
): SongOptionalColumnKey[] {
  const selected = new Set(values);
  return SONG_OPTIONAL_COLUMN_ORDER.filter((columnKey) => selected.has(columnKey));
}

export function normalizeSongColumnOrder(
  values: ReadonlyArray<string | SongOptionalColumnKey>,
): SongOptionalColumnKey[] {
  const seen = new Set<SongOptionalColumnKey>();
  const normalized: SongOptionalColumnKey[] = [];

  for (const value of values) {
    const column = value as SongOptionalColumnKey;
    if (!SONG_OPTIONAL_COLUMN_ORDER.includes(column) || seen.has(column)) {
      continue;
    }
    seen.add(column);
    normalized.push(column);
  }

  for (const column of SONG_OPTIONAL_COLUMN_ORDER) {
    if (!seen.has(column)) {
      normalized.push(column);
    }
  }

  return normalized;
}
