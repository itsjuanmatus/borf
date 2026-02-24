import { convertFileSrc } from "@tauri-apps/api/core";
import { Disc3, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils";

interface SongArtworkProps {
  artworkPath: string | null;
  onPlay?: () => void;
  className?: string;
  sizeClassName?: string;
  playLabel?: string;
}

function resolveArtworkSrc(path: string | null): string | null {
  if (!path) {
    return null;
  }
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("asset:")
  ) {
    return path;
  }

  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export function SongArtwork({
  artworkPath,
  onPlay,
  className,
  sizeClassName = "h-8 w-8",
  playLabel = "Play song",
}: SongArtworkProps) {
  const src = useMemo(() => resolveArtworkSrc(artworkPath), [artworkPath]);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div
      className={cn(
        "group/artwork relative shrink-0 overflow-hidden rounded-lg bg-surface shadow-sm",
        sizeClassName,
        className,
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sand to-blossom/20">
        <Disc3 className="h-4 w-4 text-nook" />
      </div>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          className="relative h-full w-full object-cover"
          onError={() => {
            if (src) {
              setFailedSrc(src);
            }
          }}
        />
      ) : null}

      {onPlay ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-night/45 opacity-0 transition-opacity duration-150 group-hover/song:opacity-100 group-hover/artwork:opacity-100">
          <button
            type="button"
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-night shadow-sm transition-transform duration-150 hover:scale-105"
            aria-label={playLabel}
            title={playLabel}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              onPlay();
            }}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
