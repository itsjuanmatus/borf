import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";

interface SetCustomStartDialogProps {
  isOpen: boolean;
  initialMs: number;
  currentPositionMs: number;
  targetSongCount: number;
  onClose: () => void;
  onSave: (customStartMs: number) => void;
}

function msToTimeInput(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function timeInputToMs(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  if (!trimmed.includes(":")) {
    const seconds = Number.parseFloat(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return 0;
    }
    return Math.floor(seconds * 1000);
  }

  const [minutesPart, secondsPart] = trimmed.split(":");
  const minutes = Number.parseInt(minutesPart ?? "0", 10);
  const seconds = Number.parseFloat(secondsPart ?? "0");
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0) {
    return 0;
  }
  return Math.floor((minutes * 60 + seconds) * 1000);
}

export function SetCustomStartDialog({
  isOpen,
  initialMs,
  currentPositionMs,
  targetSongCount,
  onClose,
  onSave,
}: SetCustomStartDialogProps) {
  const [value, setValue] = useState("0:00");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setValue(msToTimeInput(initialMs));
  }, [initialMs, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold">Set Custom Start Time</h3>
        <p className="mt-1 text-sm text-muted">
          This will update {targetSongCount} selected song{targetSongCount === 1 ? "" : "s"}.
        </p>

        <label className="mt-4 block text-sm">
          Start Time (m:ss or seconds)
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border p-3 text-sm outline-none focus:border-sky"
          />
        </label>

        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setValue(msToTimeInput(currentPositionMs))}
          >
            Use Current Position
          </Button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(timeInputToMs(value))}>Save</Button>
        </div>
      </div>
    </div>
  );
}
