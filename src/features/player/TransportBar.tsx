import { useDraggable } from "@dnd-kit/core";
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SongArtwork } from "../../components/song-artwork";
import { Slider } from "../../components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { usePlayerStore } from "../../stores/player-store";
import { useQueueStore } from "../../stores/queue-store";
import type { DragSongPayload, RepeatMode, SongListItem } from "../../types";

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRemaining(positionMs: number, durationMs: number) {
  const remaining = Math.max(0, durationMs - positionMs);
  return `-${formatDuration(remaining)}`;
}

interface TransportBarProps {
  currentSong: SongListItem | null;
  queueLength: number;
  songCount: number;
  upNextCount: number;
  isQueueHydrating: boolean;
  queueRestoreProgress: { hydrated: number; total: number } | null;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  volume: number;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSeek: (positionMs: number, durationMs: number) => void;
  onToggleUpNext: () => void;
  onVolumeChange: (volume: number) => void;
  onVolumeScrub?: (volume: number) => void;
  onArtistClick: (artist: string) => void;
  onAlbumClick: (album: string, albumArtist: string) => void;
  onSearchOpen: () => void;
}

export function TransportBar({
  currentSong,
  queueLength,
  songCount,
  upNextCount,
  isQueueHydrating,
  queueRestoreProgress,
  shuffleEnabled,
  repeatMode,
  volume,
  onPrevious,
  onTogglePlayback,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onSeek,
  onArtistClick,
  onAlbumClick,
  onToggleUpNext,
  onVolumeChange,
  onVolumeScrub,
  onSearchOpen,
}: TransportBarProps) {
  const playbackState = usePlayerStore((state) => state.playbackState);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const upNextOpen = useQueueStore((state) => state.isOpen);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [artworkExpanded, setArtworkExpanded] = useState(false);
  const artworkBtnRef = useRef<HTMLButtonElement>(null);

  const dragPayload: DragSongPayload | undefined = currentSong
    ? { type: "song", songIds: [currentSong.id], source: "library" }
    : undefined;
  const draggable = useDraggable({
    id: currentSong ? `transport-song:${currentSong.id}` : "transport-song:none",
    data: dragPayload,
    disabled: !currentSong,
  });

  useEffect(() => {
    if (!artworkExpanded) return;
    function handleMouseDown(e: MouseEvent) {
      if (artworkBtnRef.current && !artworkBtnRef.current.contains(e.target as Node)) {
        setArtworkExpanded(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setArtworkExpanded(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [artworkExpanded]);

  return (
    <header className="bg-night select-none transition-all duration-300 ease-out">
      <div className="flex items-center px-4 py-2">
        {/* Window drag region */}
        <div className="w-28" />

        {/* Transport controls — left */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                  shuffleEnabled ? "bg-leaf/70 text-cloud" : "text-cloud/60 hover:text-cloud",
                )}
                onClick={onToggleShuffle}
                disabled={queueLength === 0}
              >
                <Shuffle className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{shuffleEnabled ? "Shuffle: On" : "Shuffle: Off"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-cloud/60 transition-colors hover:text-cloud"
                onClick={onPrevious}
                disabled={queueLength === 0}
              >
                <SkipBack className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Previous</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cloud text-night transition-colors hover:bg-cloud/90"
                onClick={onTogglePlayback}
                disabled={queueLength === 0 && songCount === 0}
              >
                {playbackState === "playing" ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5 ml-0.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{playbackState === "playing" ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-cloud/60 transition-colors hover:text-cloud"
                onClick={onNext}
                disabled={queueLength === 0}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Next</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                  repeatMode !== "off" ? "bg-leaf/70 text-cloud" : "text-cloud/60 hover:text-cloud",
                )}
                onClick={onCycleRepeat}
              >
                {repeatMode === "one" ? (
                  <Repeat1 className="h-3 w-3" />
                ) : (
                  <Repeat className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {repeatMode === "off"
                ? "Repeat: Off"
                : repeatMode === "all"
                  ? "Repeat: All"
                  : "Repeat: One"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Artwork + info + progress — center */}
        <div
          ref={draggable.setNodeRef}
          {...draggable.attributes}
          {...draggable.listeners}
          className="flex min-w-0 items-center gap-3"
        >
          <button
            ref={artworkBtnRef}
            type="button"
            className={cn(
              "shrink-0 transition-all duration-300 ease-out",
              currentSong?.artwork_path ? "cursor-pointer hover:opacity-90" : "cursor-default",
            )}
            onClick={() => {
              if (currentSong?.artwork_path) {
                setArtworkExpanded((prev) => !prev);
              }
            }}
            aria-label={artworkExpanded ? "Collapse artwork" : "Expand artwork"}
          >
            <SongArtwork
              artworkPath={currentSong?.artwork_path ?? null}
              sizeClassName={cn(
                "transition-all duration-300 ease-out",
                artworkExpanded ? "h-24 w-24 rounded-xl" : "h-10 w-10",
              )}
            />
          </button>
          <div className="flex w-80 min-w-0 flex-col gap-0.5">
            {/* Title + artist */}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cloud">
                {currentSong?.title ?? "Nothing playing"}
              </p>
              <p className="truncate text-xs text-cloud/50">
                {currentSong ? (
                  <>
                    <button
                      type="button"
                      className="cursor-pointer hover:text-cloud/70 hover:underline"
                      onClick={() => onArtistClick(currentSong.artist)}
                    >
                      {currentSong.artist}
                    </button>
                    <span> — </span>
                    <button
                      type="button"
                      className="cursor-pointer hover:text-cloud/70 hover:underline"
                      onClick={() => onAlbumClick(currentSong.album, currentSong.artist)}
                    >
                      {currentSong.album}
                    </button>
                  </>
                ) : (
                  "Double-click a song to start"
                )}
              </p>
              {isQueueHydrating && queueRestoreProgress ? (
                <p className="truncate text-[10px] text-cloud/45">
                  Restoring queue {queueRestoreProgress.hydrated.toLocaleString()} /{" "}
                  {queueRestoreProgress.total.toLocaleString()}
                </p>
              ) : null}
            </div>
            {/* Progress scrubber */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] tabular-nums text-cloud/40">
                {formatDuration(scrubValue ?? positionMs)}
              </span>
              <Slider
                className="flex-1"
                value={[scrubValue ?? Math.min(positionMs, durationMs || positionMs)]}
                max={Math.max(durationMs, 1)}
                step={250}
                trackClassName="bg-cloud/15 h-1 cursor-pointer"
                thumbClassName="h-2.5 w-2.5 bg-cloud border-cloud/30 cursor-pointer"
                onValueChange={(value) => {
                  setScrubValue(value[0] ?? 0);
                }}
                onValueCommit={(value) => {
                  const nextPosition = value[0] ?? 0;
                  setScrubValue(null);
                  onSeek(nextPosition, durationMs);
                }}
              />
              <span className="text-[10px] tabular-nums text-cloud/40">
                {formatRemaining(scrubValue ?? positionMs, durationMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Volume — right */}
        <div className="flex items-center gap-1.5">
          <Volume2 className="h-3.5 w-3.5 text-cloud/50" />
          <div className="w-24">
            <Slider
              value={[localVolume ?? volume * 100]}
              max={100}
              step={1}
              trackClassName="bg-cloud/15 h-1"
              rangeClassName="bg-cloud/40"
              thumbClassName="h-3 w-3 bg-cloud border-cloud/30"
              onValueChange={(value) => {
                const v = value[0] ?? 0;
                setLocalVolume(v);
                onVolumeScrub?.(v / 100);
              }}
              onValueCommit={(value) => {
                setLocalVolume(null);
                onVolumeChange((value[0] ?? 0) / 100);
              }}
            />
          </div>
        </div>

        {/* Search */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="ml-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-cloud/50 transition-colors hover:text-cloud"
              onClick={onSearchOpen}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Search (⌘K)</TooltipContent>
        </Tooltip>

        {/* Queue toggle — far right */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                upNextOpen ? "bg-leaf/70 text-cloud" : "text-cloud/50 hover:text-cloud",
              )}
              onClick={onToggleUpNext}
            >
              <ListMusic className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Up Next ({upNextCount})</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
