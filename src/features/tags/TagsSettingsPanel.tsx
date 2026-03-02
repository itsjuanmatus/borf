import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input } from "../../components/ui/input";
import { TextInputDialog } from "../../components/ui/TextInputDialog";
import type { Tag } from "../../types";

interface TagsSettingsPanelProps {
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<void>;
  onRenameTag: (tag: Tag, nextName: string) => Promise<void>;
  onSetTagColor: (tag: Tag, nextColor: string) => Promise<void>;
  onDeleteTag: (tag: Tag) => Promise<void>;
}

export function TagsSettingsPanel({
  tags,
  onCreateTag,
  onRenameTag,
  onSetTagColor,
  onDeleteTag,
}: TagsSettingsPanelProps) {
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#A8D8EA");
  const [isCreating, setIsCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Tag | null>(null);
  const [colorTarget, setColorTarget] = useState<Tag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const renameDialogKey = renameTarget
    ? `rename-tag:${renameTarget.id}:${renameTarget.name}`
    : "rename-tag-closed";
  const colorDialogKey = colorTarget
    ? `color-tag:${colorTarget.id}:${colorTarget.color}`
    : "color-tag-closed";

  const handleCreate = async () => {
    if (!newTagName.trim()) {
      return;
    }
    setIsCreating(true);
    try {
      await onCreateTag(newTagName, newTagColor);
      setNewTagName("");
      setNewTagColor("#A8D8EA");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="rounded-2xl bg-cloud/8 p-4">
      <h3 className="text-base font-semibold text-cloud">Tags</h3>
      <p className="mt-1 text-sm text-muted-on-dark">Create and manage custom tags for songs.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="New tag name"
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          className="max-w-xs"
        />
        <input
          type="color"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={newTagColor}
          onChange={(event) => setNewTagColor(event.target.value)}
          className="h-9 w-14 rounded-lg bg-cloud/10 p-1"
          aria-label="Tag color"
        />
        <Button onClick={() => void handleCreate()} disabled={isCreating || !newTagName.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Create Tag
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        {tags.length === 0 ? <p className="text-sm text-muted-on-dark">No tags yet.</p> : null}
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between rounded-xl bg-cloud/5 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-3.5 w-3.5 rounded-full border border-cloud/20"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate text-sm text-cloud">{tag.name}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setRenameTarget(tag)}
              >
                <Pencil className="mr-1 h-3 w-3" />
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setColorTarget(tag)}
              >
                Color
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-red-600"
                onClick={() => setDeleteTarget(tag)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <TextInputDialog
        key={renameDialogKey}
        isOpen={Boolean(renameTarget)}
        title="Rename Tag"
        initialValue={renameTarget?.name ?? ""}
        confirmLabel="Save"
        onClose={() => setRenameTarget(null)}
        onConfirm={(value) => {
          if (!renameTarget) {
            return;
          }
          void onRenameTag(renameTarget, value.trim());
          setRenameTarget(null);
        }}
      />

      <TextInputDialog
        key={colorDialogKey}
        isOpen={Boolean(colorTarget)}
        title="Set Tag Color"
        description="Use a hex color value like #A8D8EA."
        initialValue={colorTarget?.color ?? "#A8D8EA"}
        confirmLabel="Save"
        onClose={() => setColorTarget(null)}
        onConfirm={(value) => {
          if (!colorTarget) {
            return;
          }
          void onSetTagColor(colorTarget, value.trim());
          setColorTarget(null);
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Tag"
        description={
          deleteTarget
            ? `Delete tag "${deleteTarget.name}"? This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) {
            return;
          }
          void onDeleteTag(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}
