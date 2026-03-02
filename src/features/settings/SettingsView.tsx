import { Download } from "lucide-react";
import type { RefObject } from "react";
import { Slider } from "../../components/ui/slider";
import type { SongOptionalColumnKey, Tag } from "../../types";
import { TagsSettingsPanel } from "../tags/TagsSettingsPanel";
import { SongColumnsSettingsPanel } from "./SongColumnsSettingsPanel";

interface SettingsViewProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollTopChange: (scrollTop: number) => void;
  columnOrder: SongOptionalColumnKey[];
  visibleColumns: SongOptionalColumnKey[];
  onToggleColumn: (column: SongOptionalColumnKey) => void;
  onMoveColumn: (column: SongOptionalColumnKey, direction: "up" | "down") => void;
  onResetDefaults: () => void;
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<void>;
  onRenameTag: (tag: Tag, nextName: string) => Promise<void>;
  onSetTagColor: (tag: Tag, nextColor: string) => Promise<void>;
  onDeleteTag: (tag: Tag) => Promise<void>;
  onExportPlayStatsCsv: () => void;
  onExportTagsCsv: () => void;
  onExportHierarchyMd: () => void;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  onCrossfadeEnabledChange: (enabled: boolean) => void;
  onCrossfadeSecondsChange: (seconds: number) => void;
}

export function SettingsView({
  scrollRef,
  onScrollTopChange,
  columnOrder,
  visibleColumns,
  onToggleColumn,
  onMoveColumn,
  onResetDefaults,
  tags,
  onCreateTag,
  onRenameTag,
  onSetTagColor,
  onDeleteTag,
  onExportPlayStatsCsv,
  onExportTagsCsv,
  onExportHierarchyMd,
  crossfadeEnabled,
  crossfadeSeconds,
  onCrossfadeEnabledChange,
  onCrossfadeSecondsChange,
}: SettingsViewProps) {
  return (
    <div className="h-full rounded-2xl bg-cloud/5 p-4">
      <div
        ref={scrollRef}
        className="h-full overflow-auto"
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
      >
        <SongColumnsSettingsPanel
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          onToggleColumn={onToggleColumn}
          onMoveColumn={onMoveColumn}
          onResetDefaults={onResetDefaults}
        />

        <div className="mt-8">
          <section className="rounded-2xl bg-cloud/8 p-4">
            <h3 className="text-base font-semibold text-cloud">Playback</h3>
            <p className="mt-1 text-sm text-muted-on-dark">
              Blend queue advances by overlapping song transitions.
            </p>

            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-cloud">
              <input
                type="checkbox"
                checked={crossfadeEnabled}
                onChange={(event) => onCrossfadeEnabledChange(event.currentTarget.checked)}
                className="h-4 w-4 accent-leaf"
              />
              <span>Crossfade Songs</span>
            </label>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-on-dark">
                <span>Duration</span>
                <span className={crossfadeEnabled ? "text-cloud" : "text-muted-on-dark/70"}>
                  {crossfadeSeconds}s
                </span>
              </div>
              <Slider
                min={1}
                max={12}
                step={1}
                value={[crossfadeSeconds]}
                disabled={!crossfadeEnabled}
                className={crossfadeEnabled ? "" : "opacity-60"}
                onValueChange={(value) => {
                  const nextSeconds = value[0];
                  if (typeof nextSeconds === "number") {
                    onCrossfadeSecondsChange(nextSeconds);
                  }
                }}
              />
              <p className="mt-2 text-[11px] text-muted-on-dark">1 to 12 seconds</p>
            </div>
          </section>
        </div>

        <div className="mt-8">
          <TagsSettingsPanel
            tags={tags}
            onCreateTag={onCreateTag}
            onRenameTag={onRenameTag}
            onSetTagColor={onSetTagColor}
            onDeleteTag={onDeleteTag}
          />
        </div>

        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-cloud">Export</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
              onClick={onExportPlayStatsCsv}
            >
              <Download className="h-4 w-4" />
              Play Stats CSV
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
              onClick={onExportTagsCsv}
            >
              <Download className="h-4 w-4" />
              Tags CSV
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl bg-cloud/8 px-3 py-2 text-sm text-cloud transition-all hover:bg-cloud/12"
              onClick={onExportHierarchyMd}
            >
              <Download className="h-4 w-4" />
              Library Hierarchy (Markdown)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
