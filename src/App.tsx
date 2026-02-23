import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "./components/ui/button";
import { ScrollArea } from "./components/ui/scroll-area";
import { Slider } from "./components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { audioApi, libraryApi } from "./lib/api";
import { cn } from "./lib/utils";
import { usePlayerStore } from "./stores/player-store";
import { useSessionStore } from "./stores/session-store";
import type {
  AudioErrorEvent,
  AudioPositionEvent,
  AudioStateEvent,
  AudioTrackEndedEvent,
  ScanProgressEvent,
  SongListItem,
} from "./types";

const PAGE_SIZE = 2_000;

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [statusMessage, setStatusMessage] = useState("Choose a music folder to start scanning.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sidebarSize = useSessionStore((state) => state.sidebarSize);
  const setSidebarSize = useSessionStore((state) => state.setSidebarSize);
  const persistedVolume = useSessionStore((state) => state.volume);
  const setPersistedVolume = useSessionStore((state) => state.setVolume);

  const songs = usePlayerStore((state) => state.songs);
  const nowPlaying = usePlayerStore((state) => state.nowPlaying);
  const currentIndex = usePlayerStore((state) => state.currentIndex);
  const playbackState = usePlayerStore((state) => state.playbackState);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const setSongs = usePlayerStore((state) => state.setSongs);
  const setNowPlaying = usePlayerStore((state) => state.setNowPlaying);
  const setCurrentIndex = usePlayerStore((state) => state.setCurrentIndex);
  const setPlaybackState = usePlayerStore((state) => state.setPlaybackState);
  const setPosition = usePlayerStore((state) => state.setPosition);

  const refreshSongs = useCallback(async () => {
    const nextSongs = await libraryApi.getSongs({
      limit: PAGE_SIZE,
      offset: 0,
      sort: "title",
      order: "asc",
    });

    setSongs(nextSongs);

    if (nextSongs.length === 0) {
      setStatusMessage("No songs found yet. Scan a folder to begin.");
      setNowPlaying(null);
      setCurrentIndex(null);
      setPlaybackState("stopped");
      setPosition(0, 0);
      return;
    }

    setStatusMessage(`Loaded ${nextSongs.length.toLocaleString()} song(s).`);

    if (currentIndex !== null && currentIndex >= nextSongs.length) {
      setCurrentIndex(null);
      setNowPlaying(null);
      setPlaybackState("stopped");
      setPosition(0, 0);
    }
  }, [currentIndex, setCurrentIndex, setNowPlaying, setPlaybackState, setPosition, setSongs]);

  useEffect(() => {
    void refreshSongs().catch((error: unknown) => {
      setErrorMessage(String(error));
    });
  }, [refreshSongs]);

  const playSong = useCallback(
    async (index: number, startMs?: number) => {
      if (index < 0 || index >= songs.length) {
        return;
      }

      const song = songs[index];
      await audioApi.play(song.id, startMs);
      setCurrentIndex(index);
      setNowPlaying(song);
      setPlaybackState("playing");
      setPosition(startMs ?? song.custom_start_ms ?? 0, song.duration_ms);
      setErrorMessage(null);
    },
    [songs, setCurrentIndex, setNowPlaying, setPlaybackState, setPosition],
  );

  const playNext = useCallback(() => {
    if (songs.length === 0) {
      return;
    }

    const baseIndex = currentIndex ?? -1;
    const nextIndex = (baseIndex + 1) % songs.length;
    void playSong(nextIndex).catch((error: unknown) => setErrorMessage(String(error)));
  }, [currentIndex, playSong, songs.length]);

  const playPrevious = useCallback(() => {
    if (songs.length === 0) {
      return;
    }

    if (positionMs > 3000) {
      void audioApi.seek(0).catch((error: unknown) => setErrorMessage(String(error)));
      setPosition(0, durationMs);
      return;
    }

    const baseIndex = currentIndex ?? 0;
    const previousIndex = baseIndex === 0 ? songs.length - 1 : baseIndex - 1;
    void playSong(previousIndex).catch((error: unknown) => setErrorMessage(String(error)));
  }, [currentIndex, durationMs, playSong, positionMs, setPosition, songs.length]);

  const handleTogglePlayback = useCallback(async () => {
    if (playbackState === "playing") {
      await audioApi.pause();
      setPlaybackState("paused");
      return;
    }

    if (playbackState === "paused") {
      await audioApi.resume();
      setPlaybackState("playing");
      return;
    }

    if (currentIndex !== null) {
      await playSong(currentIndex);
      return;
    }

    if (songs.length > 0) {
      await playSong(0);
    }
  }, [currentIndex, playSong, playbackState, setPlaybackState, songs.length]);

  const handlePickFolderAndScan = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a music folder",
    });

    if (typeof selected !== "string") {
      return;
    }

    setIsScanning(true);
    setScanProgress(null);
    setStatusMessage(`Scanning ${selected}...`);
    setErrorMessage(null);

    try {
      await libraryApi.scan(selected);
      await refreshSongs();
      setStatusMessage("Scan complete.");
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsScanning(false);
    }
  }, [refreshSongs]);

  useEffect(() => {
    void audioApi.setVolume(persistedVolume).catch(() => {
      // Ignore initial volume sync errors; a later explicit user action can retry.
    });
  }, [persistedVolume]);

  useEffect(() => {
    const unlisteners: Array<Promise<UnlistenFn>> = [
      listen<ScanProgressEvent>("library:scan-progress", (event) => {
        setScanProgress(event.payload);
      }),
      listen<AudioStateEvent>("audio:state-changed", (event) => {
        setPlaybackState(event.payload.state);
      }),
      listen<AudioPositionEvent>("audio:position-update", (event) => {
        setPosition(event.payload.current_ms, event.payload.duration_ms);
      }),
      listen<AudioTrackEndedEvent>("audio:track-ended", (_event) => {
        playNext();
      }),
      listen<AudioErrorEvent>("audio:error", (event) => {
        setErrorMessage(event.payload.message);
      }),
    ];

    return () => {
      void Promise.all(unlisteners).then((callbacks) => {
        for (const callback of callbacks) {
          callback();
        }
      });
    };
  }, [playNext, setPlaybackState, setPosition]);

  const progressPercent = useMemo(() => {
    if (!scanProgress || scanProgress.total === 0) {
      return 0;
    }
    return Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100));
  }, [scanProgress]);

  const currentSong: SongListItem | null =
    nowPlaying ?? (currentIndex !== null ? (songs[currentIndex] ?? null) : null);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col text-text">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Group orientation="horizontal" className="h-full w-full">
            <Panel
              id="sidebar"
              defaultSize={`${sidebarSize}%`}
              minSize="16%"
              maxSize="35%"
              onResize={(size) => setSidebarSize(Math.round(size.asPercentage))}
            >
              <aside className="h-full border-r border-border/80 bg-surface/85 p-4 backdrop-blur-sm">
                <div className="mb-6 flex items-center gap-2">
                  <div className="rounded-full bg-sky p-2 text-night">
                    <Waves className="h-4 w-4" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight">borf</h1>
                    <p className="text-xs text-muted">Phase 1 player</p>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => void handlePickFolderAndScan()}
                  disabled={isScanning}
                >
                  <FolderOpen className="h-4 w-4" />
                  {isScanning ? "Scanning..." : "Scan Music Folder"}
                </Button>

                <div className="mt-6 space-y-2 rounded-xl border border-border bg-white/80 p-3 text-sm">
                  <p className="font-medium">Library</p>
                  <p className="text-muted">Songs</p>
                  <p className="text-muted">Albums (Phase 2)</p>
                  <p className="text-muted">Artists (Phase 2)</p>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-white/80 p-3 text-xs text-muted">
                  <p className="font-medium text-text">Status</p>
                  <p className="mt-1 break-words">{statusMessage}</p>
                  {scanProgress ? (
                    <div className="mt-2 space-y-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-sky/30">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-200"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <p>
                        {scanProgress.scanned.toLocaleString()} /{" "}
                        {scanProgress.total.toLocaleString()}
                      </p>
                      <p className="truncate" title={scanProgress.current_file}>
                        {scanProgress.current_file}
                      </p>
                    </div>
                  ) : null}
                  {errorMessage ? <p className="mt-2 text-red-600">{errorMessage}</p> : null}
                </div>
              </aside>
            </Panel>

            <Separator className="w-1 bg-transparent transition-colors hover:bg-sky/60" />

            <Panel id="main" minSize="40%">
              <main className="flex h-full min-h-0 flex-col bg-white/70 backdrop-blur-sm">
                <header className="flex items-center justify-between border-b border-border px-6 py-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Songs</h2>
                    <p className="text-sm text-muted">{songs.length.toLocaleString()} loaded</p>
                  </div>
                </header>

                <div className="min-h-0 flex-1 px-4 pb-4 pt-2">
                  <div className="grid grid-cols-[36px_2fr_1.5fr_1.5fr_120px] gap-3 rounded-t-xl border border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <span>#</span>
                    <span>Title</span>
                    <span>Artist</span>
                    <span>Album</span>
                    <span className="text-right">Duration</span>
                  </div>

                  <ScrollArea className="h-[calc(100%-3rem)] rounded-b-xl border border-t-0 border-border bg-white">
                    <div>
                      {songs.map((song, index) => {
                        const isActive = currentSong?.id === song.id;
                        return (
                          <button
                            key={song.id}
                            type="button"
                            onClick={() =>
                              void playSong(index).catch((error: unknown) =>
                                setErrorMessage(String(error)),
                              )
                            }
                            className={cn(
                              "grid w-full grid-cols-[36px_2fr_1.5fr_1.5fr_120px] gap-3 border-b border-border/70 px-3 py-2 text-left text-sm transition-colors hover:bg-sky/15",
                              isActive && "bg-blossom/25",
                            )}
                          >
                            <span className="text-muted">{index + 1}</span>
                            <span className="truncate font-medium">{song.title}</span>
                            <span className="truncate text-muted">{song.artist}</span>
                            <span className="truncate text-muted">{song.album}</span>
                            <span className="text-right text-muted">
                              {formatDuration(song.duration_ms)}
                            </span>
                          </button>
                        );
                      })}
                      {songs.length === 0 ? (
                        <p className="p-6 text-sm text-muted">No songs to display yet.</p>
                      ) : null}
                    </div>
                  </ScrollArea>
                </div>
              </main>
            </Panel>
          </Group>
        </div>

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
                    : "Pick a song from the list"}
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
                      onClick={playPrevious}
                      disabled={songs.length === 0}
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
                      onClick={() =>
                        void handleTogglePlayback().catch((error: unknown) =>
                          setErrorMessage(String(error)),
                        )
                      }
                      disabled={songs.length === 0}
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
                      onClick={playNext}
                      disabled={songs.length === 0}
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Next</TooltipContent>
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
                    setPosition(nextPosition, durationMs);
                    void audioApi
                      .seek(nextPosition)
                      .catch((error: unknown) => setErrorMessage(String(error)));
                  }}
                />
                <span className="w-10">{formatDuration(durationMs)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs text-muted">
              <Volume2 className="h-4 w-4" />
              <div className="w-28">
                <Slider
                  value={[persistedVolume * 100]}
                  max={100}
                  step={1}
                  onValueChange={(value) => {
                    const nextVolume = (value[0] ?? 0) / 100;
                    setPersistedVolume(nextVolume);
                    void audioApi
                      .setVolume(nextVolume)
                      .catch((error: unknown) => setErrorMessage(String(error)));
                  }}
                />
              </div>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

export default App;
