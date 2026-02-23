CREATE TABLE IF NOT EXISTS play_history (
    id                 TEXT PRIMARY KEY,
    song_id            TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    started_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at           TEXT,
    duration_played_ms INTEGER NOT NULL DEFAULT 0,
    completed          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_play_history_song_id    ON play_history(song_id);
CREATE INDEX IF NOT EXISTS idx_play_history_started_at ON play_history(started_at DESC);
