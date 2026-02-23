CREATE TABLE IF NOT EXISTS songs (
    id               TEXT PRIMARY KEY,
    file_path        TEXT UNIQUE NOT NULL,
    file_hash        TEXT,
    title            TEXT NOT NULL DEFAULT 'Unknown',
    artist           TEXT DEFAULT 'Unknown Artist',
    album_artist     TEXT,
    album            TEXT DEFAULT 'Unknown Album',
    track_number     INTEGER,
    disc_number      INTEGER DEFAULT 1,
    year             INTEGER,
    genre            TEXT,
    duration_ms      INTEGER NOT NULL,
    codec            TEXT,
    bitrate          INTEGER,
    sample_rate      INTEGER,
    artwork_path     TEXT,
    comment          TEXT,
    custom_start_ms  INTEGER DEFAULT 0,
    rating           INTEGER DEFAULT 0,
    play_count       INTEGER DEFAULT 0,
    skip_count       INTEGER DEFAULT 0,
    last_played_at   TEXT,
    file_modified_at TEXT,
    date_added       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_play_count ON songs(play_count DESC);
CREATE INDEX IF NOT EXISTS idx_songs_date_added ON songs(date_added DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  title,
  artist,
  album,
  album_artist,
  genre,
  comment,
  content=songs,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
  INSERT INTO songs_fts(rowid, title, artist, album, album_artist, genre, comment)
  VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;

CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, artist, album, album_artist, genre, comment)
  VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
END;

CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, title, artist, album, album_artist, genre, comment)
  VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
  INSERT INTO songs_fts(rowid, title, artist, album, album_artist, genre, comment)
  VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
