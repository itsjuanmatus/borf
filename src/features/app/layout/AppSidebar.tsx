import { BarChart2, Clock3, Disc3, Library, Settings2, UserRound } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { LibraryView, PlaylistNode, ScanProgressEvent } from "../../../types";
import { PlaylistSidebar } from "../../playlists/PlaylistSidebar";

interface AppSidebarProps {
  activeView: LibraryView;
  playlists: PlaylistNode[];
  activePlaylistId: string | null;
  isScanning: boolean;
  statusMessage: string;
  errorMessage: string | null;
  scanProgress: ScanProgressEvent | null;
  progressPercent: number;
  onNavigateSongs: () => void;
  onNavigateAlbums: () => void;
  onNavigateArtists: () => void;
  onNavigateSettings: () => void;
  onNavigateHistory: () => void;
  onNavigateStats: () => void;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (parentId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenamePlaylist: (playlist: PlaylistNode) => void;
  onDeletePlaylist: (playlist: PlaylistNode) => void;
  onDuplicatePlaylist: (playlist: PlaylistNode) => void;
  onExportM3u8: (playlist: PlaylistNode) => void;
}

export function AppSidebar({
  activeView,
  playlists,
  activePlaylistId,
  isScanning,
  statusMessage,
  errorMessage,
  scanProgress,
  progressPercent,
  onNavigateSongs,
  onNavigateAlbums,
  onNavigateArtists,
  onNavigateSettings,
  onNavigateHistory,
  onNavigateStats,
  onSelectPlaylist,
  onCreatePlaylist,
  onCreateFolder,
  onRenamePlaylist,
  onDeletePlaylist,
  onDuplicatePlaylist,
  onExportM3u8,
}: AppSidebarProps) {
  return (
    <aside className="h-full select-none overflow-y-auto bg-surface-dark p-4">
      <div className="mb-6 flex items-center gap-2">
        <img src="app-icon.png" alt="Borf" className="h-12 w-12" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-cloud">borf</h1>
          <p className="text-xs text-muted-on-dark">your cozy music library</p>
        </div>
      </div>

      <div className="mt-6 space-y-1 text-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
          Library
        </p>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "songs"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateSongs}
        >
          <Library className="h-4 w-4" />
          Songs
        </button>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "albums"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateAlbums}
        >
          <Disc3 className="h-4 w-4" />
          Albums
        </button>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "artists"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateArtists}
        >
          <UserRound className="h-4 w-4" />
          Artists
        </button>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "settings"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateSettings}
        >
          <Settings2 className="h-4 w-4" />
          Settings
        </button>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "history"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateHistory}
        >
          <Clock3 className="h-4 w-4" />
          History
        </button>

        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
            activeView === "stats"
              ? "bg-leaf/25 text-cloud"
              : "text-muted-on-dark hover:bg-cloud/8",
          )}
          onClick={onNavigateStats}
        >
          <BarChart2 className="h-4 w-4" />
          Stats
        </button>
      </div>

      <PlaylistSidebar
        playlists={playlists}
        activePlaylistId={activePlaylistId}
        onSelectPlaylist={onSelectPlaylist}
        onCreatePlaylist={onCreatePlaylist}
        onCreateFolder={onCreateFolder}
        onRenamePlaylist={onRenamePlaylist}
        onDeletePlaylist={onDeletePlaylist}
        onDuplicatePlaylist={onDuplicatePlaylist}
        onExportM3u8={onExportM3u8}
      />

      <div className="mt-4 rounded-xl bg-cloud/5 p-3 text-xs text-muted-on-dark">
        <p className="font-medium text-cloud">Status</p>
        {isScanning ? <p className="mt-1 text-accent">Scanning in progress...</p> : null}
        <p className="mt-1 break-words">{statusMessage}</p>
        {scanProgress ? (
          <div className="mt-2 space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-cloud/15">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p>
              {scanProgress.scanned.toLocaleString()} / {scanProgress.total.toLocaleString()}
            </p>
            <p className="truncate" title={scanProgress.current_file}>
              {scanProgress.current_file}
            </p>
          </div>
        ) : null}
        {errorMessage ? <p className="mt-2 text-red-600">{errorMessage}</p> : null}
      </div>
    </aside>
  );
}
