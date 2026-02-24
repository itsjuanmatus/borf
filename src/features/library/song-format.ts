export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateAdded(dateAdded: string | null) {
  if (!dateAdded) {
    return "—";
  }

  const parsed = new Date(dateAdded);
  if (Number.isNaN(parsed.getTime())) {
    return dateAdded;
  }

  return parsed.toLocaleDateString();
}
