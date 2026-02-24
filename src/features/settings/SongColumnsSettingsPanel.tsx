import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  SONG_OPTIONAL_COLUMN_CONFIG,
  type SongOptionalColumnConfigItem,
} from "../../lib/song-columns";
import type { SongOptionalColumnKey } from "../../types";

interface SongColumnsSettingsPanelProps {
  columnOrder: SongOptionalColumnKey[];
  visibleColumns: SongOptionalColumnKey[];
  onToggleColumn: (column: SongOptionalColumnKey) => void;
  onMoveColumn: (column: SongOptionalColumnKey, direction: "up" | "down") => void;
  onResetDefaults: () => void;
}

function getColumnLabel(columnKey: SongOptionalColumnKey): string {
  const config: SongOptionalColumnConfigItem = SONG_OPTIONAL_COLUMN_CONFIG[columnKey];
  return config.label;
}

export function SongColumnsSettingsPanel({
  columnOrder,
  visibleColumns,
  onToggleColumn,
  onMoveColumn,
  onResetDefaults,
}: SongColumnsSettingsPanelProps) {
  const visible = new Set(visibleColumns);

  return (
    <section className="rounded-2xl bg-cloud/8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-cloud">Song Table Columns</h3>
          <p className="mt-1 text-sm text-muted-on-dark">
            Choose which columns are visible and set their order in the Songs view.
          </p>
          <p className="mt-1 text-xs text-muted-on-dark">
            <span className="font-semibold text-cloud">#</span> and{" "}
            <span className="font-semibold text-cloud">Title</span> are always visible.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onResetDefaults}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {columnOrder.map((columnKey, index) => (
          <div
            key={columnKey}
            className="flex items-center gap-2 rounded-xl bg-cloud/5 px-3 py-2 text-sm text-cloud"
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={visible.has(columnKey)}
                onChange={() => onToggleColumn(columnKey)}
                className="h-4 w-4 accent-leaf"
              />
              <span className="truncate">{getColumnLabel(columnKey)}</span>
            </label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => onMoveColumn(columnKey, "up")}
                disabled={index === 0}
                title="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => onMoveColumn(columnKey, "down")}
                disabled={index === columnOrder.length - 1}
                title="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
