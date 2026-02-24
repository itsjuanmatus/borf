import { BarChart2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { statsApi } from "../../lib/api";
import type { DashboardStats } from "../../types";

const PERIODS = [
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "All Time", value: null },
] as const;

const LIVE_REFRESH_DEBOUNCE_MS = 350;
const PALETTE = [
  "#A8D8EA",
  "#FADADD",
  "#C3E6CB",
  "#FFE5B4",
  "#D5C4F7",
  "#FFD1DC",
  "#B5EAD7",
  "#E2F0CB",
  "#FFDAC1",
  "#C7CEEA",
];

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

function msToMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

function formatListenTime(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${msToHours(ms)}h`;
  return `${msToMinutes(ms)}m`;
}

interface StatsViewProps {
  refreshSignal: number;
}

export function StatsView({ refreshSignal }: StatsViewProps) {
  const [periodDays, setPeriodDays] = useState<number | null>(30);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const seenRefreshSignalRef = useRef(refreshSignal);

  const loadStats = useCallback(async (days: number | null) => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    try {
      const data = await statsApi.getDashboard(days);
      if (requestSeq === requestSeqRef.current) {
        setStats(data);
      }
    } catch {
      // ignore
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStats(periodDays);
  }, [periodDays, loadStats]);

  useEffect(() => {
    if (refreshSignal === seenRefreshSignalRef.current) {
      return;
    }
    seenRefreshSignalRef.current = refreshSignal;

    const timeoutId = window.setTimeout(() => {
      void loadStats(periodDays);
    }, LIVE_REFRESH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadStats, periodDays, refreshSignal]);

  if (loading && !stats) {
    return (
      <div className="flex h-full items-center justify-center text-muted-on-dark">
        Loading stats...
      </div>
    );
  }

  if (!stats || (stats.total_plays === 0 && !loading)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-on-dark">
        <BarChart2 className="h-12 w-12 opacity-40" />
        <p className="text-lg font-medium">No stats yet</p>
        <p className="text-sm">Play some songs to see your listening statistics.</p>
      </div>
    );
  }

  const dailyData = stats.listening_by_day.map((d) => ({
    date: d.date.slice(5),
    hours: msToHours(d.total_listen_ms),
  }));

  const topSongsData = stats.top_songs.map((s) => ({
    name: `${s.title} — ${s.artist}`.slice(0, 40),
    plays: s.play_count,
  }));

  const topArtistsData = stats.top_artists.map((a) => ({
    name: a.artist.slice(0, 30),
    plays: a.play_count,
  }));

  const topAlbumsData = stats.top_albums.map((a) => ({
    name: `${a.album} — ${a.album_artist}`.slice(0, 40),
    plays: a.play_count,
  }));

  const genreData = stats.genre_breakdown.slice(0, 10).map((g, i) => ({
    name: g.genre,
    value: g.play_count,
    fill: PALETTE[i % PALETTE.length],
  }));

  // Heatmap data: build a 52-week x 7-day grid
  const heatmapCells = buildHeatmapCells(stats.listening_by_day);

  return (
    <div className="h-full overflow-auto p-1">
      {/* Period selector */}
      <div className="mb-6 flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
              periodDays === p.value
                ? "bg-leaf/25 text-cloud"
                : "text-muted-on-dark hover:bg-cloud/8"
            }`}
            onClick={() => setPeriodDays(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Total Songs" value={stats.total_songs.toLocaleString()} />
        <StatCard label="Listening Time" value={formatListenTime(stats.total_listen_ms)} />
        <StatCard
          label="Longest Streak"
          value={`${stats.longest_streak_days} day${stats.longest_streak_days !== 1 ? "s" : ""}`}
        />
      </div>

      {/* Listening over time */}
      {dailyData.length > 0 ? (
        <ChartSection title="Listening Over Time">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="hours"
                stroke="#A8D8EA"
                strokeWidth={2}
                dot={false}
                name="Hours"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartSection>
      ) : null}

      {/* Top Songs */}
      {topSongsData.length > 0 ? (
        <ChartSection title="Top 10 Songs">
          <ResponsiveContainer width="100%" height={topSongsData.length * 32 + 20}>
            <BarChart data={topSongsData} layout="vertical" margin={{ left: 120 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="plays" fill="#FADADD" radius={[0, 4, 4, 0]} name="Plays" />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      ) : null}

      {/* Top Artists */}
      {topArtistsData.length > 0 ? (
        <ChartSection title="Top 10 Artists">
          <ResponsiveContainer width="100%" height={topArtistsData.length * 32 + 20}>
            <BarChart data={topArtistsData} layout="vertical" margin={{ left: 100 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip />
              <Bar dataKey="plays" fill="#C3E6CB" radius={[0, 4, 4, 0]} name="Plays" />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      ) : null}

      {/* Top Albums */}
      {topAlbumsData.length > 0 ? (
        <ChartSection title="Top 10 Albums">
          <ResponsiveContainer width="100%" height={topAlbumsData.length * 32 + 20}>
            <BarChart data={topAlbumsData} layout="vertical" margin={{ left: 120 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="plays" fill="#FFE5B4" radius={[0, 4, 4, 0]} name="Plays" />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      ) : null}

      {/* Genre breakdown */}
      {genreData.length > 0 ? (
        <ChartSection title="Genre Breakdown">
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={220} height={220}>
              <PieChart>
                <Pie
                  data={genreData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {genreData.map((entry, index) => (
                    <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1">
              {genreData.map((g, i) => (
                <div key={g.name} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="text-muted-on-dark">
                    {g.name} ({g.value})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ChartSection>
      ) : null}

      {/* Listening heatmap */}
      <ChartSection title="Listening Heatmap">
        <div
          className="grid gap-[2px]"
          style={{
            gridTemplateColumns: "repeat(53, 1fr)",
            gridTemplateRows: "repeat(7, 1fr)",
          }}
        >
          {heatmapCells.map((cell) => (
            <div
              key={cell.key}
              className="aspect-square rounded-[2px]"
              style={{ backgroundColor: cell.color }}
              title={cell.tooltip}
            />
          ))}
        </div>
      </ChartSection>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-cloud/8 p-4">
      <p className="text-sm text-muted-on-dark">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-cloud">{value}</p>
    </div>
  );
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-2xl bg-cloud/8 p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-on-dark">{title}</h3>
      {children}
    </div>
  );
}

interface HeatmapCell {
  key: string;
  color: string;
  tooltip: string;
}

function buildHeatmapCells(
  dailyData: Array<{ date: string; total_listen_ms: number }>,
): HeatmapCell[] {
  const listenByDate = new Map<string, number>();
  for (const d of dailyData) {
    listenByDate.set(d.date, d.total_listen_ms);
  }

  const maxMs = Math.max(1, ...Array.from(listenByDate.values()));
  const cells: HeatmapCell[] = [];

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 370);
  const dayOfWeek = startDate.getDay();
  startDate.setDate(startDate.getDate() - dayOfWeek);

  const current = new Date(startDate);
  for (let week = 0; week < 53; week++) {
    for (let day = 0; day < 7; day++) {
      const dateStr = current.toISOString().slice(0, 10);
      const ms = listenByDate.get(dateStr) ?? 0;
      const intensity = ms / maxMs;

      let color: string;
      if (ms === 0) {
        color = "#f0f0f0";
      } else if (intensity < 0.25) {
        color = "#D5E8D4";
      } else if (intensity < 0.5) {
        color = "#A8D8EA";
      } else if (intensity < 0.75) {
        color = "#FADADD";
      } else {
        color = "#D5C4F7";
      }

      const hours = Math.round((ms / 3_600_000) * 10) / 10;
      cells.push({
        key: dateStr,
        color,
        tooltip: ms > 0 ? `${dateStr}: ${hours}h` : dateStr,
      });

      current.setDate(current.getDate() + 1);
    }
  }

  return cells;
}
