import type { AlbumIdentity, NavigationRoute, NavigationSnapshot } from "./navigation-types";

export function cloneAlbumIdentity(album: AlbumIdentity): AlbumIdentity {
  return {
    album: album.album,
    album_artist: album.album_artist,
  };
}

export function normalizeTagFilterIds(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function normalizeScrollPosition(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function isSameAlbumIdentity(left: AlbumIdentity, right: AlbumIdentity) {
  return left.album === right.album && left.album_artist === right.album_artist;
}

export function navigationRouteKey(route: NavigationRoute) {
  switch (route.kind) {
    case "songs":
      return "songs";
    case "albums-list":
      return "albums-list";
    case "albums-detail":
      return `albums-detail:${encodeURIComponent(route.album.album)}:${encodeURIComponent(route.album.album_artist)}`;
    case "artists-list":
      return "artists-list";
    case "artists-detail":
      return `artists-detail:${encodeURIComponent(route.artist)}`;
    case "artists-album-detail":
      return `artists-album-detail:${encodeURIComponent(route.artist)}:${encodeURIComponent(route.album.album)}:${encodeURIComponent(route.album.album_artist)}`;
    case "playlist":
      return `playlist:${route.playlistId}`;
    case "history":
      return "history";
    case "stats":
      return "stats";
    case "settings":
      return "settings";
    default:
      throw new Error(`Unhandled route kind: ${(route as { kind: string }).kind}`);
  }
}

function navigationRoutesEqual(left: NavigationRoute, right: NavigationRoute) {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "songs":
    case "albums-list":
    case "artists-list":
    case "history":
    case "stats":
    case "settings":
      return true;
    case "albums-detail":
      return isSameAlbumIdentity(
        left.album,
        (right as Extract<NavigationRoute, { kind: "albums-detail" }>).album,
      );
    case "artists-detail":
      return left.artist === (right as Extract<NavigationRoute, { kind: "artists-detail" }>).artist;
    case "artists-album-detail":
      return (
        left.artist ===
          (right as Extract<NavigationRoute, { kind: "artists-album-detail" }>).artist &&
        isSameAlbumIdentity(
          left.album,
          (right as Extract<NavigationRoute, { kind: "artists-album-detail" }>).album,
        )
      );
    case "playlist":
      return (
        left.playlistId === (right as Extract<NavigationRoute, { kind: "playlist" }>).playlistId
      );
    default:
      return false;
  }
}

export function navigationSnapshotsEqual(left: NavigationSnapshot, right: NavigationSnapshot) {
  return (
    navigationRoutesEqual(left.route, right.route) &&
    left.searchQuery === right.searchQuery &&
    left.playlistReorderMode === right.playlistReorderMode &&
    left.upNextOpen === right.upNextOpen &&
    left.selectedTagFilterIds.length === right.selectedTagFilterIds.length &&
    left.selectedTagFilterIds.every((tagId, index) => tagId === right.selectedTagFilterIds[index])
  );
}
