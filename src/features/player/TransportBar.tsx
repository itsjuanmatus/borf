import {
  Clipboard,
  Music2,
  PanelRightOpen,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Slider } from "../../components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { usePlayerStore } from "../../stores/player-store";
import type { RepeatMode, SongListItem } from "../../types";

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface TransportBarProps {
  currentSong: SongListItem | null;
  queueLength: number;
  songCount: number;
  upNextCount: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  clipboardHint: string | null;
  clipboardCount: number;
  volume: number;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSeek: (positionMs: number, durationMs: number) => void;
  onOpenUpNext: () => void;
  onClearClipboard: () => void;
  onVolumeChange: (volume: number) => void;
}

export function TransportBar({
  currentSong,
  queueLength,
  songCount,
  upNextCount,
  shuffleEnabled,
  repeatMode,
  clipboardHint,
  clipboardCount,
  volume,
  onPrevious,
  onTogglePlayback,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onSeek,
  onOpenUpNext,
  onClearClipboard,
  onVolumeChange,
}: TransportBarProps) {
  const playbackState = usePlayerStore((state) => state.playbackState);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);

  return (
    <footer className="border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm">
      <div className="grid grid-cols-3 items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sky/40">
            <Music2 className="h-6 w-6 text-night/70" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {currentSong?.title ?? "Nothing playing"}
            </p>
            <p className="truncate text-xs text-muted">
              {currentSong
                ? `${currentSong.artist} • ${currentSong.album}`
                : "Double-click a song to start playback"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={onPrevious}
                  disabled={queueLength === 0}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={onTogglePlayback}
                  disabled={queueLength === 0 && songCount === 0}
                >
                  {playbackState === "playing" ? (
                    <Pause className="h-5 w-5" />
                  ) : (
                    <Play className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{playbackState === "playing" ? "Pause" : "Play"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={onNext}
                  disabled={queueLength === 0}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={shuffleEnabled ? "default" : "secondary"}
                  onClick={onToggleShuffle}
                  disabled={queueLength === 0}
                >
                  <Shuffle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{shuffleEnabled ? "Shuffle: On" : "Shuffle: Off"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={repeatMode === "off" ? "secondary" : "default"}
                  onClick={onCycleRepeat}
                >
                  <Repeat className="h-4 w-4" />
                </Button>
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

          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="w-10 text-right">{formatDuration(positionMs)}</span>
            <Slider
              value={[Math.min(positionMs, durationMs || positionMs)]}
              max={Math.max(durationMs, 1)}
              step={250}
              onValueCommit={(value) => {
                const nextPosition = value[0] ?? 0;
                onSeek(nextPosition, durationMs);
              }}
            />
            <span className="w-10">{formatDuration(durationMs)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 text-xs text-muted">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mr-1"
            onClick={onOpenUpNext}
          >
            <PanelRightOpen className="mr-1 h-3.5 w-3.5" />
            Up Next ({upNextCount})
          </Button>
          <p className="mr-2">Queue: {queueLength}</p>
          {clipboardHint ? (
            <span className="rounded-full bg-sky/20 px-2 py-1 text-[11px] text-text">
              {clipboardHint}
            </span>
          ) : null}
          {clipboardCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onClearClipboard}
            >
              <Clipboard className="mr-1 h-3.5 w-3.5" />
              {clipboardCount} copied
            </Button>
          ) : null}
          <Volume2 className="h-4 w-4" />
          <div className="w-28">
            <Slider
              value={[volume * 100]}
              max={100}
              step={1}
              onValueChange={(value) => {
                const nextVolume = (value[0] ?? 0) / 100;
                onVolumeChange(nextVolume);
              }}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
