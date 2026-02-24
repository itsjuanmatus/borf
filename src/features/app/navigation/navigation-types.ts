import type { AlbumListItem } from "../../../types";

export type AlbumIdentity = Pick<AlbumListItem, "album" | "album_artist">;

export type NavigationRoute =
  | { kind: "songs" }
  | { kind: "albums-list" }
  | { kind: "albums-detail"; album: AlbumIdentity }
  | { kind: "artists-list" }
  | { kind: "artists-detail"; artist: string }
  | { kind: "artists-album-detail"; artist: string; album: AlbumIdentity }
  | { kind: "playlist"; playlistId: string }
  | { kind: "history" }
  | { kind: "stats" }
  | { kind: "settings" };

export type NavigationScrollPositions = Record<string, number>;

export interface NavigationSnapshot {
  route: NavigationRoute;
  searchQuery: string;
  selectedTagFilterIds: string[];
  playlistReorderMode: boolean;
  upNextOpen: boolean;
  scrollByRoute: NavigationScrollPositions;
}
