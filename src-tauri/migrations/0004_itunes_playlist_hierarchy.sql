ALTER TABLE playlists ADD COLUMN source_type TEXT;
ALTER TABLE playlists ADD COLUMN source_external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_playlists_source_external
ON playlists(source_type, source_external_id);
