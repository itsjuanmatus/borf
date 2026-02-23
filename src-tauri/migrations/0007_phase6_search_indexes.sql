CREATE INDEX IF NOT EXISTS idx_songs_is_missing_title_nocase
    ON songs(is_missing, title COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_playlists_is_folder_name_nocase
    ON playlists(is_folder, name COLLATE NOCASE);
