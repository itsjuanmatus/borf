import { Folder, ListMusic } from "lucide-react";
import type { ComponentProps, RefObject } from "react";
import type { LibraryView, PlaylistNode } from "../../../types";
import { HistoryView } from "../../history/HistoryView";
import { AlbumsView } from "../../library/views/AlbumsView";
import { ArtistsView } from "../../library/views/ArtistsView";
import { SongsView } from "../../library/views/SongsView";
import { PlaylistView } from "../../playlists/PlaylistView";
import { SettingsView } from "../../settings/SettingsView";
import { StatsView } from "../../stats/StatsView";

type SongsViewProps = ComponentProps<typeof SongsView>;
type PlaylistViewProps = ComponentProps<typeof PlaylistView>;
type AlbumsViewProps = ComponentProps<typeof AlbumsView>;
type ArtistsViewProps = ComponentProps<typeof ArtistsView>;
type SettingsViewProps = ComponentProps<typeof SettingsView>;

export interface AppMainContentProps {
  activeView: LibraryView;
  activePlaylist: PlaylistNode | null;
  activePlaylistId: string | null;
  activeFolderChildren: PlaylistNode[];
  playlistFolderScrollRef: RefObject<HTMLDivElement | null>;
  onPlaylistFolderScrollTopChange: (scrollTop: number) => void;
  onNavigateToPlaylist: (playlistId: string) => void;
  songsViewProps: SongsViewProps;
  playlistViewProps: PlaylistViewProps;
  albumsViewProps: AlbumsViewProps;
  artistsViewProps: ArtistsViewProps;
  historyViewProps: {
    restoreScrollTop: number | null;
    refreshSignal: number;
    onScrollTopChange: (scrollTop: number) => void;
    onPlaySong: (songId: string) => void;
  };
  statsScrollRef: RefObject<HTMLDivElement | null>;
  onStatsScrollTopChange: (scrollTop: number) => void;
  statsRefreshSignal: number;
  settingsViewProps: SettingsViewProps;
}

export function AppMainContent({
  activeView,
  activePlaylist,
  activePlaylistId,
  activeFolderChildren,
  playlistFolderScrollRef,
  onPlaylistFolderScrollTopChange,
  onNavigateToPlaylist,
  songsViewProps,
  playlistViewProps,
  albumsViewProps,
  artistsViewProps,
  historyViewProps,
  statsScrollRef,
  onStatsScrollTopChange,
  statsRefreshSignal,
  settingsViewProps,
}: AppMainContentProps) {
  return (
    <section className="min-h-0 flex-1 px-4 pb-4 pt-2">
      <div style={{ display: activeView === "songs" ? undefined : "none" }} className="h-full">
        <SongsView {...songsViewProps} />
      </div>

      <div style={{ display: activeView === "playlist" ? undefined : "none" }} className="h-full">
        {activePlaylist?.is_folder ? (
          <div className="flex h-full min-h-0 flex-col rounded-2xl bg-cloud/5">
            <div className="px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-on-dark">
                Folder Contents
              </p>
            </div>
            <div
              ref={playlistFolderScrollRef}
              className="min-h-0 flex-1 overflow-auto p-2"
              onScroll={(event) => {
                if (!activePlaylistId) {
                  return;
                }
                onPlaylistFolderScrollTopChange(event.currentTarget.scrollTop);
              }}
            >
              {activeFolderChildren.length > 0 ? (
                <div className="space-y-1">
                  {activeFolderChildren.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-cloud hover:bg-cloud/8"
                      onClick={() => onNavigateToPlaylist(child.id)}
                    >
                      {child.is_folder ? (
                        <Folder className="h-4 w-4 shrink-0 text-muted-on-dark" />
                      ) : (
                        <ListMusic className="h-4 w-4 shrink-0 text-muted-on-dark" />
                      )}
                      <span className="truncate">{child.name}</span>
                      <span className="ml-auto text-xs text-muted-on-dark">
                        {child.is_folder ? "Folder" : "Playlist"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl bg-cloud/5 text-sm text-muted-on-dark">
                  This folder is empty.
                </div>
              )}
            </div>
          </div>
        ) : (
          <PlaylistView {...playlistViewProps} />
        )}
      </div>

      <div style={{ display: activeView === "albums" ? undefined : "none" }} className="h-full">
        <AlbumsView {...albumsViewProps} />
      </div>

      <div style={{ display: activeView === "artists" ? undefined : "none" }} className="h-full">
        <ArtistsView {...artistsViewProps} />
      </div>

      <div style={{ display: activeView === "history" ? undefined : "none" }} className="h-full">
        <div className="h-full rounded-2xl bg-cloud/5">
          <HistoryView
            restoreScrollTop={historyViewProps.restoreScrollTop}
            refreshSignal={historyViewProps.refreshSignal}
            onScrollTopChange={historyViewProps.onScrollTopChange}
            onPlaySong={historyViewProps.onPlaySong}
          />
        </div>
      </div>

      <div style={{ display: activeView === "stats" ? undefined : "none" }} className="h-full">
        <div className="h-full rounded-2xl bg-cloud/5 p-4">
          <div
            ref={statsScrollRef}
            className="h-full overflow-auto"
            onScroll={(event) => onStatsScrollTopChange(event.currentTarget.scrollTop)}
          >
            <StatsView refreshSignal={statsRefreshSignal} />
          </div>
        </div>
      </div>

      <div style={{ display: activeView === "settings" ? undefined : "none" }} className="h-full">
        <SettingsView {...settingsViewProps} />
      </div>
    </section>
  );
}
