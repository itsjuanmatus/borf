import { Download } from "lucide-react";
import type { RefObject } from "react";
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
  onRenameTag: (tag: Tag) => Promise<void>;
  onSetTagColor: (tag: Tag) => Promise<void>;
  onDeleteTag: (tag: Tag) => Promise<void>;
  onExportPlayStatsCsv: () => void;
  onExportTagsCsv: () => void;
  onExportHierarchyMd: () => void;
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
