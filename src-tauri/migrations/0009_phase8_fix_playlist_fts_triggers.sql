DROP TRIGGER IF EXISTS playlists_ai_fts;
DROP TRIGGER IF EXISTS playlists_ad_fts;
DROP TRIGGER IF EXISTS playlists_au_fts;
DROP TRIGGER IF EXISTS playlists_parent_name_au_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS playlists_fts USING fts5(
    name,
    parent_name,
    kind,
    tokenize='unicode61'
);

DELETE FROM playlists_fts;

INSERT INTO playlists_fts(rowid, name, parent_name, kind)
SELECT
    p.rowid,
    p.name,
    COALESCE(parent.name, ''),
    CASE WHEN p.is_folder = 1 THEN 'folder' ELSE 'playlist' END
FROM playlists p
LEFT JOIN playlists parent ON parent.id = p.parent_id;

CREATE TRIGGER IF NOT EXISTS playlists_ai_fts AFTER INSERT ON playlists BEGIN
  INSERT INTO playlists_fts(rowid, name, parent_name, kind)
  VALUES (
    new.rowid,
    new.name,
    COALESCE((SELECT parent.name FROM playlists parent WHERE parent.id = new.parent_id), ''),
    CASE WHEN new.is_folder = 1 THEN 'folder' ELSE 'playlist' END
  );
END;

CREATE TRIGGER IF NOT EXISTS playlists_ad_fts AFTER DELETE ON playlists BEGIN
  DELETE FROM playlists_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS playlists_au_fts AFTER UPDATE ON playlists BEGIN
  DELETE FROM playlists_fts WHERE rowid = old.rowid;

  INSERT INTO playlists_fts(rowid, name, parent_name, kind)
  VALUES (
    new.rowid,
    new.name,
    COALESCE((SELECT parent.name FROM playlists parent WHERE parent.id = new.parent_id), ''),
    CASE WHEN new.is_folder = 1 THEN 'folder' ELSE 'playlist' END
  );
END;

CREATE TRIGGER IF NOT EXISTS playlists_parent_name_au_fts AFTER UPDATE OF name ON playlists BEGIN
  DELETE FROM playlists_fts
  WHERE rowid IN (
    SELECT child.rowid
    FROM playlists child
    WHERE child.parent_id = old.id
  );

  INSERT INTO playlists_fts(rowid, name, parent_name, kind)
  SELECT
    child.rowid,
    child.name,
    COALESCE(new.name, ''),
    CASE WHEN child.is_folder = 1 THEN 'folder' ELSE 'playlist' END
  FROM playlists child
  WHERE child.parent_id = new.id;
END;
