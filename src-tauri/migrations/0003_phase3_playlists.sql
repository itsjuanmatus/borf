CREATE INDEX IF NOT EXISTS idx_playlists_parent_sort ON playlists(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_playlists_parent_name_nocase ON playlists(parent_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_song ON playlist_tracks(playlist_id, song_id);
