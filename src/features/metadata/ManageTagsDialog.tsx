import { Button } from "../../components/ui/button";
import type { Tag } from "../../types";

interface ManageTagsDialogProps {
  isOpen: boolean;
  tags: Tag[];
  selectedTagIds: string[];
  targetSongCount: number;
  onToggleTag: (tagId: string, checked: boolean) => void;
  onClose: () => void;
  onApply: () => void;
}

export function ManageTagsDialog({
  isOpen,
  tags,
  selectedTagIds,
  targetSongCount,
  onToggleTag,
  onClose,
  onApply,
}: ManageTagsDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-cloud p-8 shadow-2xl">
        <h3 className="text-lg font-semibold">Manage Tags</h3>
        <p className="mt-1 text-sm text-muted">
          Apply tags to {targetSongCount} selected song{targetSongCount === 1 ? "" : "s"}.
        </p>

        <div className="mt-4 max-h-72 space-y-2 overflow-auto rounded-2xl bg-sand/50 p-3">
          {tags.length === 0 ? <p className="text-sm text-muted">No tags available.</p> : null}
          {tags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedTagIds.includes(tag.id)}
                onChange={(event) => onToggleTag(tag.id, event.target.checked)}
              />
              <span
                className="h-3.5 w-3.5 rounded-full border border-border/70"
                style={{ backgroundColor: tag.color }}
              />
              <span>{tag.name}</span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onApply}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
