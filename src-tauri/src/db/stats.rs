use super::*;

impl Database {
    pub fn stats_get_dashboard(&self, period_days: Option<i64>) -> Result<DashboardStats, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        let date_filter = match period_days {
            Some(days) => format!("WHERE ph.started_at >= datetime('now', '-{days} days')"),
            None => String::new(),
        };

        let totals_query = format!(
            "SELECT COUNT(*),
                    COALESCE(SUM(ph.duration_played_ms), 0),
                    COUNT(DISTINCT ph.song_id)
             FROM play_history ph {date_filter}"
        );
        let (total_plays, total_listen_ms, total_songs): (i64, i64, i64) = connection
            .query_row(&totals_query, [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|error| format!("failed to query total stats: {error}"))?;

        let top_songs_query = format!(
            "SELECT ph.song_id, s.title, s.artist, s.artwork_path,
                    COUNT(*) as pc, COALESCE(SUM(ph.duration_played_ms), 0) as tlms
             FROM play_history ph
             INNER JOIN songs s ON s.id = ph.song_id
             {date_filter}
             GROUP BY ph.song_id
             ORDER BY pc DESC
             LIMIT 10"
        );
        let mut stmt = connection
            .prepare(&top_songs_query)
            .map_err(|error| format!("failed to prepare top songs query: {error}"))?;
        let top_songs = stmt
            .query_map([], |row| {
                Ok(TopSongStat {
                    song_id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    artwork_path: row.get(3)?,
                    play_count: row.get(4)?,
                    total_listen_ms: row.get(5)?,
                })
            })
            .map_err(|error| format!("failed to query top songs: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode top song row: {error}"))?;

        let top_artists_query = format!(
            "SELECT s.artist, COUNT(*) as pc, COALESCE(SUM(ph.duration_played_ms), 0) as tlms
             FROM play_history ph
             INNER JOIN songs s ON s.id = ph.song_id
             {date_filter}
             GROUP BY s.artist
             ORDER BY pc DESC
             LIMIT 10"
        );
        let mut stmt = connection
            .prepare(&top_artists_query)
            .map_err(|error| format!("failed to prepare top artists query: {error}"))?;
        let top_artists = stmt
            .query_map([], |row| {
                Ok(TopArtistStat {
                    artist: row.get(0)?,
                    play_count: row.get(1)?,
                    total_listen_ms: row.get(2)?,
                })
            })
            .map_err(|error| format!("failed to query top artists: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode top artist row: {error}"))?;

        let top_albums_query = format!(
            "SELECT s.album, COALESCE(s.album_artist, s.artist), s.artwork_path,
                    COUNT(*) as pc, COALESCE(SUM(ph.duration_played_ms), 0) as tlms
             FROM play_history ph
             INNER JOIN songs s ON s.id = ph.song_id
             {date_filter}
             GROUP BY s.album, COALESCE(s.album_artist, s.artist)
             ORDER BY pc DESC
             LIMIT 10"
        );
        let mut stmt = connection
            .prepare(&top_albums_query)
            .map_err(|error| format!("failed to prepare top albums query: {error}"))?;
        let top_albums = stmt
            .query_map([], |row| {
                Ok(TopAlbumStat {
                    album: row.get(0)?,
                    album_artist: row.get(1)?,
                    artwork_path: row.get(2)?,
                    play_count: row.get(3)?,
                    total_listen_ms: row.get(4)?,
                })
            })
            .map_err(|error| format!("failed to query top albums: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode top album row: {error}"))?;

        let genre_query = format!(
            "SELECT COALESCE(s.genre, 'Unknown'), COUNT(*) as pc
             FROM play_history ph
             INNER JOIN songs s ON s.id = ph.song_id
             {date_filter}
             GROUP BY s.genre
             ORDER BY pc DESC"
        );
        let mut stmt = connection
            .prepare(&genre_query)
            .map_err(|error| format!("failed to prepare genre query: {error}"))?;
        let genre_breakdown = stmt
            .query_map([], |row| {
                Ok(GenreStat {
                    genre: row.get(0)?,
                    play_count: row.get(1)?,
                })
            })
            .map_err(|error| format!("failed to query genre breakdown: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode genre row: {error}"))?;

        let daily_query = format!(
            "SELECT date(ph.started_at) as d,
                    COALESCE(SUM(ph.duration_played_ms), 0),
                    COUNT(*)
             FROM play_history ph
             {date_filter}
             GROUP BY d
             ORDER BY d ASC"
        );
        let mut stmt = connection
            .prepare(&daily_query)
            .map_err(|error| format!("failed to prepare daily stats query: {error}"))?;
        let listening_by_day = stmt
            .query_map([], |row| {
                Ok(DayListenStat {
                    date: row.get(0)?,
                    total_listen_ms: row.get(1)?,
                    play_count: row.get(2)?,
                })
            })
            .map_err(|error| format!("failed to query daily stats: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to decode daily stat row: {error}"))?;

        let longest_streak_days = compute_longest_listening_streak(&listening_by_day);

        Ok(DashboardStats {
            period_days,
            total_songs,
            total_plays,
            total_listen_ms,
            longest_streak_days,
            top_songs,
            top_artists,
            top_albums,
            genre_breakdown,
            listening_by_day,
        })
    }

    // ── Export Queries ────────────────────────────────────────────
}

pub(super) fn compute_longest_listening_streak(daily_data: &[DayListenStat]) -> i64 {
    let mut dates = daily_data
        .iter()
        .filter_map(|entry| chrono::NaiveDate::parse_from_str(&entry.date, "%Y-%m-%d").ok())
        .collect::<Vec<_>>();

    if dates.is_empty() {
        return 0;
    }

    dates.sort_unstable();
    dates.dedup();

    let mut longest = 1_i64;
    let mut current = 1_i64;

    for pair in dates.windows(2) {
        let gap_days = pair[1].signed_duration_since(pair[0]).num_days();
        if gap_days == 1 {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 1;
        }
    }

    longest
}
