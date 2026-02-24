import { convertFileSrc } from "@tauri-apps/api/core";
import { Disc3 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils";

interface SongArtworkProps {
  artworkPath: string | null;
  className?: string;
  sizeClassName?: string;
}

export function resolveArtworkSrc(path: string | null): string | null {
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
  className,
  sizeClassName = "h-8 w-8",
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

    </div>
  );
}
