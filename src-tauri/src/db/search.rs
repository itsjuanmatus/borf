use super::utils::{build_song_tag_clause_values, normalize_string_ids, normalize_tag_ids};
use super::*;
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::time::Instant;

impl Database {
    pub fn search_library(
        &self,
        query: &str,
        limit: u32,
        tag_ids: &[String],
    ) -> Result<LibrarySearchResult, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() && tag_ids.is_empty() {
            return Ok(LibrarySearchResult {
                songs: Vec::new(),
                albums: Vec::new(),
                artists: Vec::new(),
                playlists: Vec::new(),
                folders: Vec::new(),
            });
        }

        let connection = self.lock_search_connection()?;

        let (text_query, inline_tag_names) = split_search_query(trimmed);
        let mut required_tag_ids = normalize_tag_ids(tag_ids);
        for tag_name in inline_tag_names {
            let resolved = connection
                .query_row(
                    "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE LIMIT 1",
                    params![tag_name],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("failed to resolve inline tag search: {error}"))?;

            if let Some(tag_id) = resolved {
                if !required_tag_ids.contains(&tag_id) {
                    required_tag_ids.push(tag_id);
                }
            } else {
                return Ok(LibrarySearchResult {
                    songs: Vec::new(),
                    albums: Vec::new(),
                    artists: Vec::new(),
                    playlists: Vec::new(),
                    folders: Vec::new(),
                });
            }
        }

        let fts_query = build_fts_query(&text_query);
        let escaped_text_query = escape_like_pattern(&text_query);
        let prefix_pattern = format!("{escaped_text_query}%");
        let contains_pattern = format!("%{escaped_text_query}%");
        let (tag_clause, tag_values) = build_song_tag_clause_values(&required_tag_ids);
        let mut songs = Vec::new();

        if let Some(fts_query) = fts_query.clone() {
            let query = format!(
                "
                SELECT
                    s.id,
                    s.title,
                    s.artist,
                    s.album,
                    s.duration_ms,
                    s.artwork_path,
                    s.file_path,
                    s.custom_start_ms,
                    s.play_count,
                    s.comment,
                    s.date_added
                FROM songs_fts
                JOIN songs s ON s.rowid = songs_fts.rowid
                WHERE s.is_missing = 0
                  AND songs_fts MATCH ?
                  {tag_clause}
                ORDER BY
                    CASE
                        WHEN s.title LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 0
                        WHEN s.artist LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1
                        WHEN s.album LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 2
                        ELSE 3
                    END,
                    bm25(songs_fts),
                    s.title COLLATE NOCASE ASC
                LIMIT ?
                "
            );
            let mut values = vec![SqlValue::from(fts_query)];
            values.extend(tag_values.clone());
            values.push(SqlValue::from(prefix_pattern.clone()));
            values.push(SqlValue::from(prefix_pattern.clone()));
            values.push(SqlValue::from(prefix_pattern.clone()));
            values.push(SqlValue::Integer(i64::from(limit)));

            let mut song_statement = connection
                .prepare(&query)
                .map_err(|error| format!("failed to prepare search songs query: {error}"))?;
            let rows = song_statement
                .query_map(params_from_iter(values), |row| {
                    Ok(SongListItem {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        artist: row.get(2)?,
                        album: row.get(3)?,
                        duration_ms: row.get(4)?,
                        artwork_path: row.get(5)?,
                        file_path: row.get(6)?,
                        custom_start_ms: row.get(7)?,
                        play_count: row.get(8)?,
                        comment: row.get(9)?,
                        tags: Vec::new(),
                        date_added: row.get(10)?,
                    })
                })
                .map_err(|error| format!("failed to execute songs search query: {error}"))?;

            for row in rows {
                songs.push(
                    row.map_err(|error| format!("failed to decode songs search row: {error}"))?,
                );
            }
        } else if !required_tag_ids.is_empty() {
            let query = format!(
                "
                SELECT
                    s.id,
                    s.title,
                    s.artist,
                    s.album,
                    s.duration_ms,
                    s.artwork_path,
                    s.file_path,
                    s.custom_start_ms,
                    s.play_count,
                    s.comment,
                    s.date_added
                FROM songs s
                WHERE s.is_missing = 0
                  {tag_clause}
                ORDER BY s.title COLLATE NOCASE ASC
                LIMIT ?
                "
            );
            let mut values = tag_values;
            values.push(SqlValue::Integer(i64::from(limit)));

            let mut song_statement = connection.prepare(&query).map_err(|error| {
                format!("failed to prepare tag-only songs search query: {error}")
            })?;
            let rows = song_statement
                .query_map(params_from_iter(values), |row| {
                    Ok(SongListItem {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        artist: row.get(2)?,
                        album: row.get(3)?,
                        duration_ms: row.get(4)?,
                        artwork_path: row.get(5)?,
                        file_path: row.get(6)?,
                        custom_start_ms: row.get(7)?,
                        play_count: row.get(8)?,
                        comment: row.get(9)?,
                        tags: Vec::new(),
                        date_added: row.get(10)?,
                    })
                })
                .map_err(|error| {
                    format!("failed to execute tag-only songs search query: {error}")
                })?;

            for row in rows {
                songs.push(row.map_err(|error| {
                    format!("failed to decode tag-only songs search row: {error}")
                })?);
            }
        }

        if text_query.is_empty() {
            return Ok(LibrarySearchResult {
                songs,
                albums: Vec::new(),
                artists: Vec::new(),
                playlists: Vec::new(),
                folders: Vec::new(),
            });
        }

        let mut albums = Vec::new();
        let mut artists = Vec::new();
        if let Some(fts_query) = fts_query.as_ref() {
            let mut album_statement = connection
                .prepare(
                    "
                    WITH matched AS (
                        SELECT
                            s.album AS album,
                            COALESCE(NULLIF(s.album_artist, ''), NULLIF(s.artist, ''), 'Unknown Artist') AS album_artist,
                            s.duration_ms AS duration_ms,
                            s.artwork_path AS artwork_path,
                            s.year AS year,
                            s.date_added AS date_added
                        FROM songs_fts
                        JOIN songs s ON s.rowid = songs_fts.rowid
                        WHERE s.is_missing = 0
                          AND songs_fts MATCH ?1
                    )
                    SELECT
                        album,
                        album_artist,
                        COUNT(*) AS song_count,
                        COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
                        MAX(artwork_path) AS artwork_path,
                        MAX(year) AS year,
                        MIN(date_added) AS date_added
                    FROM matched
                    GROUP BY album, album_artist
                    ORDER BY
                        CASE
                            WHEN album LIKE ?2 ESCAPE '\\' COLLATE NOCASE THEN 0
                            ELSE 1
                        END,
                        song_count DESC,
                        album COLLATE NOCASE ASC
                    LIMIT ?3
                    ",
                )
                .map_err(|error| format!("failed to prepare albums search query: {error}"))?;

            let album_rows = album_statement
                .query_map(params![fts_query, prefix_pattern, limit], |row| {
                    Ok(AlbumListItem {
                        album: row.get(0)?,
                        album_artist: row.get(1)?,
                        song_count: row.get(2)?,
                        total_duration_ms: row.get(3)?,
                        artwork_path: row.get(4)?,
                        year: row.get(5)?,
                        date_added: row.get(6)?,
                    })
                })
                .map_err(|error| format!("failed to execute albums search query: {error}"))?;

            for row in album_rows {
                albums.push(
                    row.map_err(|error| format!("failed to decode album search row: {error}"))?,
                );
            }

            let mut artist_statement = connection
                .prepare(
                    "
                    WITH matched AS (
                        SELECT
                            COALESCE(NULLIF(s.artist, ''), 'Unknown Artist') AS artist,
                            s.album AS album,
                            s.play_count AS play_count,
                            s.artwork_path AS artwork_path
                        FROM songs_fts
                        JOIN songs s ON s.rowid = songs_fts.rowid
                        WHERE s.is_missing = 0
                          AND songs_fts MATCH ?1
                    )
                    SELECT
                        artist,
                        COUNT(*) AS song_count,
                        COUNT(DISTINCT album) AS album_count,
                        COALESCE(SUM(play_count), 0) AS play_count,
                        MAX(artwork_path) AS artwork_path
                    FROM matched
                    GROUP BY artist
                    ORDER BY
                        CASE
                            WHEN artist LIKE ?2 ESCAPE '\\' COLLATE NOCASE THEN 0
                            ELSE 1
                        END,
                        song_count DESC,
                        artist COLLATE NOCASE ASC
                    LIMIT ?3
                    ",
                )
                .map_err(|error| format!("failed to prepare artists search query: {error}"))?;

            let artist_rows = artist_statement
                .query_map(params![fts_query, prefix_pattern, limit], |row| {
                    Ok(ArtistListItem {
                        artist: row.get(0)?,
                        song_count: row.get(1)?,
                        album_count: row.get(2)?,
                        play_count: row.get(3)?,
                        artwork_path: row.get(4)?,
                    })
                })
                .map_err(|error| format!("failed to execute artists search query: {error}"))?;

            for row in artist_rows {
                artists.push(
                    row.map_err(|error| format!("failed to decode artist search row: {error}"))?,
                );
            }
        }

        let (playlists, folders) = search_playlists_and_folders(
            &connection,
            &text_query,
            fts_query.as_deref(),
            limit,
            &prefix_pattern,
            &contains_pattern,
        )?;

        Ok(LibrarySearchResult {
            songs,
            albums,
            artists,
            playlists,
            folders,
        })
    }

    pub fn search_palette(
        &self,
        query: &str,
        limit: u32,
        tag_ids: &[String],
    ) -> Result<SearchPaletteResult, String> {
        let started_at = Instant::now();
        let bounded_limit = limit.clamp(1, 100);
        let candidate_limit = bounded_limit.saturating_mul(5).clamp(50, 250);
        let trimmed = query.trim();
        let (text_query, _) = split_search_query(trimmed);
        let query_text = normalize_search_text(&text_query);
        let query_tokens = tokenize_for_search(&query_text);
        let query_synonym_tokens = expand_tokens_with_synonyms(&query_tokens);
        let include_rank_reason =
            cfg!(debug_assertions) || std::env::var("BORF_SEARCH_DEBUG").is_ok();

        let search_result = if trimmed.is_empty() && tag_ids.is_empty() {
            LibrarySearchResult {
                songs: Vec::new(),
                albums: Vec::new(),
                artists: Vec::new(),
                playlists: Vec::new(),
                folders: Vec::new(),
            }
        } else {
            self.search_library(trimmed, candidate_limit, tag_ids)?
        };

        let mut search_result = search_result;
        if !text_query.is_empty() {
            let seed_count = search_result.songs.len()
                + search_result.albums.len()
                + search_result.artists.len()
                + search_result.playlists.len()
                + search_result.folders.len();
            if seed_count < candidate_limit as usize {
                for synonym in query_synonym_tokens.iter().take(3) {
                    let synonym_result =
                        self.search_library(synonym, candidate_limit / 2, tag_ids)?;
                    merge_library_search_results(&mut search_result, synonym_result);
                }
            }
        }

        let mut candidates = Vec::<PaletteRankCandidate>::new();

        for song in search_result.songs {
            let title = song.title.clone();
            let subtitle = format!("{} • {}", song.artist, song.album);
            let lexical = lexical_similarity(&query_text, &title, Some(&subtitle));
            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Song,
                    id: song.id.clone(),
                    title,
                    subtitle: Some(subtitle),
                    score: 0.0,
                    rank_reason: None,
                    song: Some(song),
                    album: None,
                    artist: None,
                    playlist: None,
                    action_id: None,
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        for album in search_result.albums {
            let title = album.album.clone();
            let subtitle = format!("Album • {}", album.album_artist);
            let lexical = lexical_similarity(&query_text, &title, Some(&subtitle));
            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Album,
                    id: format!("album:{}::{}", album.album, album.album_artist),
                    title,
                    subtitle: Some(subtitle),
                    score: 0.0,
                    rank_reason: None,
                    song: None,
                    album: Some(SearchPaletteAlbumRef {
                        album: album.album,
                        album_artist: album.album_artist,
                    }),
                    artist: None,
                    playlist: None,
                    action_id: None,
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        for artist in search_result.artists {
            let title = artist.artist.clone();
            let subtitle = format!(
                "Artist • {} songs • {} albums",
                artist.song_count, artist.album_count
            );
            let lexical = lexical_similarity(&query_text, &title, Some(&subtitle));
            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Artist,
                    id: format!("artist:{}", artist.artist),
                    title: artist.artist.clone(),
                    subtitle: Some(subtitle),
                    score: 0.0,
                    rank_reason: None,
                    song: None,
                    album: None,
                    artist: Some(artist.artist),
                    playlist: None,
                    action_id: None,
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        for playlist in search_result.playlists {
            let title = playlist.name.clone();
            let subtitle = playlist
                .parent_name
                .as_ref()
                .map(|parent_name| format!("Playlist • {}", parent_name))
                .or_else(|| Some(String::from("Playlist")));
            let lexical = lexical_similarity(&query_text, &title, subtitle.as_deref());
            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Playlist,
                    id: format!("playlist:{}", playlist.id),
                    title,
                    subtitle,
                    score: 0.0,
                    rank_reason: None,
                    song: None,
                    album: None,
                    artist: None,
                    playlist: Some(playlist),
                    action_id: None,
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        for folder in search_result.folders {
            let title = folder.name.clone();
            let subtitle = folder
                .parent_name
                .as_ref()
                .map(|parent_name| format!("Folder • {}", parent_name))
                .or_else(|| Some(String::from("Folder")));
            let lexical = lexical_similarity(&query_text, &title, subtitle.as_deref());
            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Folder,
                    id: format!("folder:{}", folder.id),
                    title,
                    subtitle,
                    score: 0.0,
                    rank_reason: None,
                    song: None,
                    album: None,
                    artist: None,
                    playlist: Some(folder),
                    action_id: None,
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        for action in build_palette_actions() {
            let lexical = lexical_similarity(&query_text, action.title, Some(action.search_text));
            if !query_text.is_empty() && lexical < 0.12 {
                continue;
            }

            candidates.push(PaletteRankCandidate {
                item: SearchPaletteItem {
                    kind: SearchPaletteItemKind::Action,
                    id: action.id.to_string(),
                    title: action.title.to_string(),
                    subtitle: Some(action.subtitle.to_string()),
                    score: 0.0,
                    rank_reason: None,
                    song: None,
                    album: None,
                    artist: None,
                    playlist: None,
                    action_id: Some(action.id.to_string()),
                },
                lexical_score: lexical,
                final_score: lexical,
                rank_reason: None,
            });
        }

        candidates.sort_by(|left, right| compare_desc(left.lexical_score, right.lexical_score));

        let semantic_window = candidates
            .len()
            .min((bounded_limit as usize).saturating_mul(5).max(50));
        for index in 0..semantic_window {
            let candidate = &mut candidates[index];
            let item_tokens = tokenize_for_search(&normalize_search_text(&format!(
                "{} {}",
                candidate.item.title,
                candidate.item.subtitle.clone().unwrap_or_default()
            )));
            let prefix_score = prefix_score(
                &query_text,
                &query_tokens,
                &candidate.item.title,
                &item_tokens,
            );
            let token_overlap = overlap_ratio(&query_tokens, &item_tokens);
            let synonym_overlap = overlap_ratio(&query_synonym_tokens, &item_tokens);
            let lexical = candidate.lexical_score.clamp(0.0, 1.0);
            let final_score = (0.65 * lexical)
                + (0.15 * prefix_score)
                + (0.15 * token_overlap)
                + (0.05 * synonym_overlap);

            candidate.final_score = final_score.clamp(0.0, 1.0);
            if include_rank_reason {
                candidate.rank_reason = Some(format!(
                    "lexical:{lexical:.3};prefix:{prefix_score:.3};token:{token_overlap:.3};syn:{synonym_overlap:.3}"
                ));
            }
        }

        candidates.sort_by(|left, right| compare_desc(left.final_score, right.final_score));

        let items = candidates
            .into_iter()
            .take(bounded_limit as usize)
            .map(|candidate| SearchPaletteItem {
                score: candidate.final_score,
                rank_reason: candidate.rank_reason,
                ..candidate.item
            })
            .collect();

        Ok(SearchPaletteResult {
            items,
            took_ms: started_at.elapsed().as_secs_f64() * 1000.0,
        })
    }
}

#[derive(Debug)]
struct PaletteRankCandidate {
    item: SearchPaletteItem,
    lexical_score: f64,
    final_score: f64,
    rank_reason: Option<String>,
}

#[derive(Debug)]
struct PaletteActionDefinition {
    id: &'static str,
    title: &'static str,
    subtitle: &'static str,
    search_text: &'static str,
}

fn build_palette_actions() -> &'static [PaletteActionDefinition] {
    const ACTIONS: [PaletteActionDefinition; 11] = [
        PaletteActionDefinition {
            id: "action.play_top_result",
            title: "Play Top Result",
            subtitle: "Play the best current match",
            search_text: "play top result start now",
        },
        PaletteActionDefinition {
            id: "action.queue_top_song",
            title: "Queue Top Song",
            subtitle: "Add the top matching song to Up Next",
            search_text: "queue top song up next",
        },
        PaletteActionDefinition {
            id: "action.open_songs",
            title: "Open Songs View",
            subtitle: "Jump to the Songs library",
            search_text: "songs tracks library view open",
        },
        PaletteActionDefinition {
            id: "action.open_albums",
            title: "Open Albums View",
            subtitle: "Jump to the Albums browser",
            search_text: "albums records lp view open",
        },
        PaletteActionDefinition {
            id: "action.open_artists",
            title: "Open Artists View",
            subtitle: "Jump to the Artists browser",
            search_text: "artists performers bands view open",
        },
        PaletteActionDefinition {
            id: "action.open_playlists",
            title: "Open Playlists",
            subtitle: "Jump to your playlists",
            search_text: "playlist playlists mixes folders open",
        },
        PaletteActionDefinition {
            id: "action.open_settings",
            title: "Open Settings",
            subtitle: "Open app settings",
            search_text: "settings preferences prefs configuration",
        },
        PaletteActionDefinition {
            id: "action.open_history",
            title: "Open History",
            subtitle: "Show recently played songs",
            search_text: "history recent played listens",
        },
        PaletteActionDefinition {
            id: "action.open_stats",
            title: "Open Stats",
            subtitle: "Show listening statistics",
            search_text: "stats statistics analytics dashboard",
        },
        PaletteActionDefinition {
            id: "action.scan_music_folder",
            title: "Scan Music Folder",
            subtitle: "Import songs from a folder",
            search_text: "scan rescan import folder library files",
        },
        PaletteActionDefinition {
            id: "action.import_itunes_library",
            title: "Import iTunes Library",
            subtitle: "Run iTunes XML import",
            search_text: "itunes import apple music library xml",
        },
    ];

    &ACTIONS
}

fn compare_desc(left: f64, right: f64) -> Ordering {
    right.partial_cmp(&left).unwrap_or(Ordering::Equal)
}

fn merge_library_search_results(base: &mut LibrarySearchResult, incoming: LibrarySearchResult) {
    let mut song_ids = base
        .songs
        .iter()
        .map(|song| song.id.clone())
        .collect::<HashSet<_>>();
    for song in incoming.songs {
        if song_ids.insert(song.id.clone()) {
            base.songs.push(song);
        }
    }

    let mut album_keys = base
        .albums
        .iter()
        .map(|album| (album.album.clone(), album.album_artist.clone()))
        .collect::<HashSet<_>>();
    for album in incoming.albums {
        let key = (album.album.clone(), album.album_artist.clone());
        if album_keys.insert(key) {
            base.albums.push(album);
        }
    }

    let mut artist_names = base
        .artists
        .iter()
        .map(|artist| artist.artist.clone())
        .collect::<HashSet<_>>();
    for artist in incoming.artists {
        if artist_names.insert(artist.artist.clone()) {
            base.artists.push(artist);
        }
    }

    let mut playlist_ids = base
        .playlists
        .iter()
        .map(|playlist| playlist.id.clone())
        .collect::<HashSet<_>>();
    for playlist in incoming.playlists {
        if playlist_ids.insert(playlist.id.clone()) {
            base.playlists.push(playlist);
        }
    }

    let mut folder_ids = base
        .folders
        .iter()
        .map(|folder| folder.id.clone())
        .collect::<HashSet<_>>();
    for folder in incoming.folders {
        if folder_ids.insert(folder.id.clone()) {
            base.folders.push(folder);
        }
    }
}

fn normalize_search_text(input: &str) -> String {
    input
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn tokenize_for_search(input: &str) -> Vec<String> {
    input
        .split_whitespace()
        .map(str::to_string)
        .filter(|token| !token.is_empty())
        .collect()
}

fn synonyms_for_token(token: &str) -> &'static [&'static str] {
    match token {
        "song" => &["track", "tune"],
        "track" => &["song", "tune"],
        "tune" => &["song", "track"],
        "album" => &["record", "lp"],
        "artist" => &["performer", "band"],
        "playlist" => &["mix", "queue"],
        "queue" => &["playlist", "upnext"],
        "stats" => &["statistics", "analytics"],
        "settings" => &["preferences", "prefs"],
        "history" => &["recent", "plays"],
        "scan" => &["import", "rescan"],
        "itunes" => &["apple", "xml"],
        _ => &[],
    }
}

fn expand_tokens_with_synonyms(tokens: &[String]) -> Vec<String> {
    let original = tokens.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut expanded = HashSet::<String>::new();

    for token in tokens {
        for synonym in synonyms_for_token(token) {
            if !original.contains(synonym) {
                expanded.insert((*synonym).to_string());
            }
        }
    }

    expanded.into_iter().collect()
}

fn overlap_ratio(query_tokens: &[String], item_tokens: &[String]) -> f64 {
    if query_tokens.is_empty() || item_tokens.is_empty() {
        return 0.0;
    }

    let item_set = item_tokens
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let query_set = query_tokens
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    if query_set.is_empty() {
        return 0.0;
    }

    let matches = query_set
        .iter()
        .filter(|token| item_set.contains(**token))
        .count();

    matches as f64 / query_set.len() as f64
}

fn prefix_score(
    query_text: &str,
    query_tokens: &[String],
    title: &str,
    item_tokens: &[String],
) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }

    let normalized_title = normalize_search_text(title);
    if !query_text.is_empty() && normalized_title.starts_with(query_text) {
        return 1.0;
    }

    let matches = query_tokens
        .iter()
        .filter(|query_token| {
            item_tokens
                .iter()
                .any(|token| token.starts_with(query_token.as_str()))
        })
        .count();
    matches as f64 / query_tokens.len() as f64
}

fn lexical_similarity(query_text: &str, title: &str, subtitle: Option<&str>) -> f64 {
    if query_text.is_empty() {
        return 0.45;
    }

    let normalized_title = normalize_search_text(title);
    let normalized_subtitle = normalize_search_text(subtitle.unwrap_or_default());
    let query_tokens = tokenize_for_search(query_text);
    let item_tokens = tokenize_for_search(&format!("{normalized_title} {normalized_subtitle}"));
    let overlap = overlap_ratio(&query_tokens, &item_tokens);

    let base = if normalized_title == query_text {
        1.0
    } else if normalized_title.starts_with(query_text) {
        0.95
    } else if normalized_title.contains(query_text) {
        0.82
    } else if !normalized_subtitle.is_empty() && normalized_subtitle.starts_with(query_text) {
        0.72
    } else if !normalized_subtitle.is_empty() && normalized_subtitle.contains(query_text) {
        0.62
    } else {
        0.28
    };

    (base + (0.35 * overlap)).clamp(0.0, 1.0)
}

fn search_playlists_and_folders(
    connection: &Connection,
    text_query: &str,
    fts_query: Option<&str>,
    limit: u32,
    prefix_pattern: &str,
    contains_pattern: &str,
) -> Result<(Vec<PlaylistSearchItem>, Vec<PlaylistSearchItem>), String> {
    if text_query.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let fetch_items = |is_folder: bool| -> Result<Vec<PlaylistSearchItem>, String> {
        let folder_flag = if is_folder { 1 } else { 0 };
        if let Some(fts_query) = fts_query {
            let mut statement = connection
                .prepare(
                    "
                    SELECT
                        p.id,
                        p.name,
                        p.parent_id,
                        parent.name
                    FROM playlists_fts
                    INNER JOIN playlists p ON p.rowid = playlists_fts.rowid
                    LEFT JOIN playlists parent ON parent.id = p.parent_id
                    WHERE playlists_fts MATCH ?1
                      AND p.is_folder = ?2
                    ORDER BY
                        CASE
                            WHEN p.name LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 0
                            WHEN COALESCE(parent.name, '') LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 1
                            ELSE 2
                        END,
                        bm25(playlists_fts),
                        p.name COLLATE NOCASE ASC,
                        p.id ASC
                    LIMIT ?4
                    ",
                )
                .map_err(|error| {
                    format!("failed to prepare playlists fts search query: {error}")
                })?;

            let rows = statement
                .query_map(
                    params![fts_query, folder_flag, prefix_pattern, limit],
                    |row| {
                        Ok(PlaylistSearchItem {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            parent_id: row.get(2)?,
                            parent_name: row.get(3)?,
                            is_folder,
                        })
                    },
                )
                .map_err(|error| {
                    format!("failed to execute playlists fts search query: {error}")
                })?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|error| {
                    format!("failed to decode playlists fts search row: {error}")
                })?);
            }
            return Ok(items);
        }

        let mut statement = connection
            .prepare(
                "
                SELECT
                    p.id,
                    p.name,
                    p.parent_id,
                    parent.name
                FROM playlists p
                LEFT JOIN playlists parent ON parent.id = p.parent_id
                WHERE p.is_folder = ?1
                  AND (
                    p.name LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                    OR COALESCE(parent.name, '') LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                  )
                ORDER BY
                    CASE
                        WHEN p.name LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 0
                        WHEN COALESCE(parent.name, '') LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 1
                        ELSE 2
                    END,
                    p.name COLLATE NOCASE ASC,
                    p.id ASC
                LIMIT ?4
                ",
            )
            .map_err(|error| {
                format!("failed to prepare playlists fallback search query: {error}")
            })?;

        let rows = statement
            .query_map(
                params![folder_flag, contains_pattern, prefix_pattern, limit],
                |row| {
                    Ok(PlaylistSearchItem {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        parent_name: row.get(3)?,
                        is_folder,
                    })
                },
            )
            .map_err(|error| {
                format!("failed to execute playlists fallback search query: {error}")
            })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| {
                format!("failed to decode playlists fallback search row: {error}")
            })?);
        }
        Ok(items)
    };

    let playlists = fetch_items(false)?;
    let folders = fetch_items(true)?;
    Ok((playlists, folders))
}

fn split_search_query(query: &str) -> (String, Vec<String>) {
    let mut text_terms = Vec::new();
    let mut tag_terms = Vec::new();

    for raw_term in query.split_whitespace() {
        let lower = raw_term.to_ascii_lowercase();
        if lower.starts_with("tag:") {
            let raw_name = raw_term
                .split_once(':')
                .map(|(_, value)| value)
                .unwrap_or_default()
                .trim();
            if !raw_name.is_empty() {
                tag_terms.push(raw_name.to_string());
            }
            continue;
        }
        text_terms.push(raw_term);
    }

    (text_terms.join(" "), normalize_string_ids(&tag_terms))
}

pub(super) fn build_fts_query(query: &str) -> Option<String> {
    let mut terms = Vec::new();
    for raw_term in query.split_whitespace() {
        let normalized = raw_term
            .chars()
            .filter(|character| {
                character.is_ascii_alphanumeric() || *character == '_' || *character == '-'
            })
            .collect::<String>();

        if !normalized.is_empty() {
            terms.push(format!("{normalized}*"));
        }
    }

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

pub(super) fn escape_like_pattern(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
