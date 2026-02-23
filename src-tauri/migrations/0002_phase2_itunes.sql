CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES playlists(id) ON DELETE CASCADE,
    is_folder   BOOLEAN DEFAULT 0,
    description TEXT,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlists_parent ON playlists(parent_id);
CREATE INDEX IF NOT EXISTS idx_playlists_name ON playlists(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(playlist_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);

CREATE INDEX IF NOT EXISTS idx_songs_duration ON songs(duration_ms);
CREATE INDEX IF NOT EXISTS idx_songs_title_nocase ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_artist_nocase ON songs(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_album_nocase ON songs(album COLLATE NOCASE);
