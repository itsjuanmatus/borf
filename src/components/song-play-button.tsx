import { Play } from "lucide-react";
import { cn } from "../lib/utils";

interface SongPlayButtonProps {
  onPlay: () => void;
  label?: string;
  className?: string;
}

export function SongPlayButton({
  onPlay,
  label = "Play song",
  className,
}: SongPlayButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center transition-all duration-150",
        "text-blossom",
        "hover:scale-110",
        className,
      )}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onPlay();
      }}
    >
      <Play className="h-3.5 w-3.5 fill-current" />
    </button>
  );
}
