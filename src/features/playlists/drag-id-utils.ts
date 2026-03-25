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

export function parsePlaylistGapId(id: string): { parentId: string | null; index: number } | null {
  if (!id.startsWith("playlist-gap:")) {
    return null;
  }
  const rest = id.replace("playlist-gap:", "");
  const sepIndex = rest.lastIndexOf(":");
  if (sepIndex < 0) {
    return null;
  }
  const parentPart = rest.slice(0, sepIndex);
  const indexPart = rest.slice(sepIndex + 1);
  return {
    parentId: parentPart === "root" ? null : parentPart,
    index: Number(indexPart),
  };
}
