import type { LibraryView, PlaylistNode } from "../../../types";

interface HeaderTextParams {
  activeView: LibraryView;
  songCount: number;
  albumCount: number;
  artistCount: number;
  tagCount: number;
  activePlaylist: PlaylistNode | null;
  activeFolderChildrenCount: number;
  activePlaylistTrackCount: number;
}

interface HeaderText {
  title: string;
  subtitle: string;
}

export function getHeaderText({
  activeView,
  songCount,
  albumCount,
  artistCount,
  tagCount,
  activePlaylist,
  activeFolderChildrenCount,
  activePlaylistTrackCount,
}: HeaderTextParams): HeaderText {
  if (activeView === "songs") {
    return {
      title: "Songs",
      subtitle: `${songCount.toLocaleString()} songs`,
    };
  }

  if (activeView === "albums") {
    return {
      title: "Albums",
      subtitle: `${albumCount.toLocaleString()} albums`,
    };
  }

  if (activeView === "artists") {
    return {
      title: "Artists",
      subtitle: `${artistCount.toLocaleString()} artists`,
    };
  }

  if (activeView === "history") {
    return {
      title: "History",
      subtitle: "Recent plays",
    };
  }

  if (activeView === "stats") {
    return {
      title: "Stats",
      subtitle: "Listening statistics",
    };
  }

  if (activeView === "settings") {
    return {
      title: "Settings",
      subtitle: `${tagCount.toLocaleString()} tags`,
    };
  }

  return {
    title: activePlaylist?.name ?? "Playlist",
    subtitle: activePlaylist?.is_folder
      ? `${activeFolderChildrenCount.toLocaleString()} item(s)`
      : `${activePlaylistTrackCount.toLocaleString()} songs`,
  };
}
