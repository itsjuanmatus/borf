import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";

interface EditCommentDialogProps {
  isOpen: boolean;
  initialComment: string | null;
  targetSongCount: number;
  onClose: () => void;
  onSave: (comment: string | null) => void;
}

export function EditCommentDialog({
  isOpen,
  initialComment,
  targetSongCount,
  onClose,
  onSave,
}: EditCommentDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValue(initialComment ?? "");
  }, [initialComment, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Edit Comment</h3>
        <p className="mt-1 text-sm text-muted">
          This will update {targetSongCount} selected song{targetSongCount === 1 ? "" : "s"}.
        </p>

        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={5}
          className="mt-4 w-full rounded-lg border border-border p-3 text-sm outline-none focus:border-sky"
          placeholder="Add a comment..."
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(value.trim() ? value : null)}>Save</Button>
        </div>
      </div>
    </div>
  );
}
