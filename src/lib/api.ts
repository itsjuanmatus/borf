import { invoke } from "@tauri-apps/api/core";
import type { SongListItem, SongSortField, SortOrder } from "../types";

export const libraryApi = {
  scan(folderPath: string) {
    return invoke<void>("library_scan", { folderPath });
  },
  getSongs(params: { limit: number; offset: number; sort: SongSortField; order: SortOrder }) {
    return invoke<SongListItem[]>("library_get_songs", params);
  },
};

export const audioApi = {
  play(songId: string, startMs?: number) {
    return invoke<void>("audio_play", { songId, startMs });
  },
  pause() {
    return invoke<void>("audio_pause");
  },
  resume() {
    return invoke<void>("audio_resume");
  },
  seek(positionMs: number) {
    return invoke<void>("audio_seek", { positionMs });
  },
  setVolume(volume: number) {
    return invoke<void>("audio_set_volume", { volume });
  },
};
