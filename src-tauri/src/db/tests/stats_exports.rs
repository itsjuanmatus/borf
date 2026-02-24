use super::super::stats::compute_longest_listening_streak;
use super::super::{max_export_tag_columns, DayListenStat, ExportTagRow};
use super::{seed_song, test_db};
use rusqlite::params;

#[test]
fn computes_longest_listening_streak_from_daily_data() {
    let streak = compute_longest_listening_streak(&[
        DayListenStat {
            date: String::from("2026-02-01"),
            total_listen_ms: 60_000,
            play_count: 1,
        },
        DayListenStat {
            date: String::from("2026-02-02"),
            total_listen_ms: 60_000,
            play_count: 1,
        },
        DayListenStat {
            date: String::from("2026-02-04"),
            total_listen_ms: 60_000,
            play_count: 1,
        },
        DayListenStat {
            date: String::from("2026-02-05"),
            total_listen_ms: 60_000,
            play_count: 1,
        },
        DayListenStat {
            date: String::from("2026-02-06"),
            total_listen_ms: 60_000,
            play_count: 1,
        },
    ]);

    assert_eq!(streak, 3);
}

#[test]
fn dashboard_stats_apply_period_to_total_songs_and_longest_streak() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");
    seed_song(&db, "song-3", "Song 3");

    {
        let connection = db.connection.lock().expect("failed to lock db");
        let samples = [
            ("h-1", "song-1", "-3 days"),
            ("h-2", "song-1", "-2 days"),
            ("h-3", "song-2", "-1 days"),
            ("h-4", "song-3", "-40 days"),
            ("h-5", "song-3", "-39 days"),
            ("h-6", "song-3", "-38 days"),
            ("h-7", "song-3", "-37 days"),
        ];

        for (id, song_id, offset) in samples {
            connection
                    .execute(
                        "
                        INSERT INTO play_history (id, song_id, started_at, duration_played_ms, completed)
                        VALUES (?1, ?2, datetime('now', ?3), 120000, 1)
                        ",
                        params![id, song_id, offset],
                    )
                    .expect("failed to insert play history sample");
        }
    }

    let period_stats = db
        .stats_get_dashboard(Some(7))
        .expect("failed to fetch 7-day dashboard stats");
    assert_eq!(period_stats.total_plays, 3);
    assert_eq!(period_stats.total_songs, 2);
    assert_eq!(period_stats.longest_streak_days, 3);

    let all_time_stats = db
        .stats_get_dashboard(None)
        .expect("failed to fetch all-time dashboard stats");
    assert_eq!(all_time_stats.total_songs, 3);
    assert_eq!(all_time_stats.longest_streak_days, 4);
}

#[test]
fn computes_max_export_tag_columns() {
    let empty_rows: Vec<ExportTagRow> = Vec::new();
    assert_eq!(max_export_tag_columns(&empty_rows), 0);

    let rows = vec![
        ExportTagRow {
            title: String::from("Song 1"),
            artist: String::from("Artist"),
            album: String::from("Album"),
            tags: vec![String::from("Tag A")],
        },
        ExportTagRow {
            title: String::from("Song 2"),
            artist: String::from("Artist"),
            album: String::from("Album"),
            tags: vec![
                String::from("Tag A"),
                String::from("Tag B"),
                String::from("Tag C"),
            ],
        },
    ];

    assert_eq!(max_export_tag_columns(&rows), 3);
}
