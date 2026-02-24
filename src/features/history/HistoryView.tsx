import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SongArtwork } from "../../components/song-artwork";
import { historyApi } from "../../lib/api";
import type { PlayHistoryEntry } from "../../types";

const PAGE_SIZE = 100;

interface DayGroup {
  label: string;
  entries: PlayHistoryEntry[];
}

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - entryDay.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return entryDay.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: entryDay.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatTimePlayed(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDay(entries: PlayHistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;

  for (const entry of entries) {
    const label = formatDayLabel(entry.started_at);
    if (!current || current.label !== label) {
      current = { label, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }

  return groups;
}

type FlatRow = { type: "header"; label: string } | { type: "entry"; entry: PlayHistoryEntry };

function flattenGroups(groups: DayGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({ type: "header", label: group.label });
    for (const entry of group.entries) {
      rows.push({ type: "entry", entry });
    }
  }
  return rows;
}

interface HistoryViewProps {
  onPlaySong: (songId: string) => void;
}

export function HistoryView({ onPlaySong }: HistoryViewProps) {
  const [entries, setEntries] = useState<PlayHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const page = await historyApi.getPage(PAGE_SIZE, entries.length);
      setEntries((prev) => [...prev, ...page.entries]);
      setTotal(page.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [entries.length, loading]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadMore();
  }, [loadMore]);

  const groups = groupByDay(entries);
  const flatRows = flattenGroups(groups);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (flatRows[index]?.type === "header" ? 40 : 54),
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (virtualItems.length === 0) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= flatRows.length - 5 && entries.length < total && !loading) {
      void loadMore();
    }
  }, [entries.length, flatRows.length, loadMore, loading, total, virtualItems]);

  if (!loading && entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-on-dark">
        <Clock3 className="h-12 w-12 opacity-40" />
        <p className="text-lg font-medium">No listening history yet</p>
        <p className="text-sm">Play some songs to see them here.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const row = flatRows[virtualRow.index];
          if (!row) return null;

          if (row.type === "header") {
            return (
              <div
                key={`header-${row.label}`}
                className="sticky top-0 z-10 flex items-center bg-surface-dark/90 px-4 py-2 backdrop-blur-sm"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className="text-sm font-semibold text-muted-on-dark">{row.label}</span>
              </div>
            );
          }

          const { entry } = row;
          return (
            <button
              type="button"
              key={entry.id}
              className="group/song flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-cloud/8"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => onPlaySong(entry.song_id)}
            >
              <SongArtwork artworkPath={entry.artwork_path} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-cloud">{entry.title}</p>
                <p className="truncate text-xs text-muted-on-dark">{entry.artist}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-on-dark">
                <span>{formatTimePlayed(entry.duration_played_ms)}</span>
                <span>{formatTime(entry.started_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
      {loading ? <div className="py-4 text-center text-sm text-muted-on-dark">Loading...</div> : null}
    </div>
  );
}
