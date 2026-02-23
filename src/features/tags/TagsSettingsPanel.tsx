import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { Tag } from "../../types";

interface TagsSettingsPanelProps {
  tags: Tag[];
  onCreateTag: (name: string, color: string) => Promise<void>;
  onRenameTag: (tag: Tag) => Promise<void>;
  onSetTagColor: (tag: Tag) => Promise<void>;
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
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="text-base font-semibold">Tags</h3>
      <p className="mt-1 text-sm text-muted">Create and manage custom tags for songs.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="New tag name"
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          className="max-w-xs"
        />
        <input
          type="color"
          value={newTagColor}
          onChange={(event) => setNewTagColor(event.target.value)}
          className="h-9 w-14 rounded border border-border bg-transparent p-1"
          aria-label="Tag color"
        />
        <Button onClick={() => void handleCreate()} disabled={isCreating || !newTagName.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Create Tag
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        {tags.length === 0 ? <p className="text-sm text-muted">No tags yet.</p> : null}
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-3.5 w-3.5 rounded-full border border-border/70"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate text-sm">{tag.name}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void onRenameTag(tag)}
              >
                <Pencil className="mr-1 h-3 w-3" />
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void onSetTagColor(tag)}
              >
                Color
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-red-600"
                onClick={() => void onDeleteTag(tag)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
