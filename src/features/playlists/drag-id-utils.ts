export function parsePlaylistNodeId(id: string): string | null {
  if (!id.startsWith("playlist-node:")) {
    return null;
  }
  return id.replace("playlist-node:", "");
}

export function parsePlaylistDropId(id: string): string | null {
  if (!id.startsWith("playlist-tracks-drop:")) {
    return null;
  }
  return id.replace("playlist-tracks-drop:", "");
}

export function parsePlaylistTrackId(id: string): string | null {
  if (!id.startsWith("playlist-track:")) {
    return null;
  }
  return id.replace("playlist-track:", "");
}

export function parseQueueSongId(id: string): string | null {
  if (!id.startsWith("queue-song:")) {
    return null;
  }
  return id.replace("queue-song:", "");
}
