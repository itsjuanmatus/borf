use rusqlite::Connection;

const MIGRATION_0001: &str = include_str!("../../migrations/0001_phase1.sql");
const MIGRATION_0002: &str = include_str!("../../migrations/0002_phase2_itunes.sql");
const MIGRATION_0003: &str = include_str!("../../migrations/0003_phase3_playlists.sql");
const MIGRATION_0004: &str = include_str!("../../migrations/0004_itunes_playlist_hierarchy.sql");
const MIGRATION_0005: &str = include_str!("../../migrations/0005_phase4_metadata_tags_watcher.sql");
const MIGRATION_0006: &str = include_str!("../../migrations/0006_phase5_play_history.sql");
const MIGRATION_0007: &str = include_str!("../../migrations/0007_phase6_search_indexes.sql");
const MIGRATION_0008: &str =
    include_str!("../../migrations/0008_phase7_unified_palette_search.sql");

pub(super) fn configure_main_connection(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 2500;
            PRAGMA temp_store = MEMORY;
            ",
        )
        .map_err(|error| format!("failed to configure sqlite main connection pragmas: {error}"))
}

pub(super) fn configure_search_connection(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA busy_timeout = 2500;
            PRAGMA temp_store = MEMORY;
            PRAGMA query_only = ON;
            ",
        )
        .map_err(|error| format!("failed to configure sqlite search connection pragmas: {error}"))
}

pub(super) fn run_migrations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;

    let migration_1_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 1)",
        [],
        |row| row.get(0),
    )?;

    if !migration_1_applied {
        connection.execute_batch(MIGRATION_0001)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (1)", [])?;
    }

    let migration_2_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 2)",
        [],
        |row| row.get(0),
    )?;

    if !migration_2_applied {
        connection.execute_batch(MIGRATION_0002)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (2)", [])?;
    }

    let migration_3_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 3)",
        [],
        |row| row.get(0),
    )?;

    if !migration_3_applied {
        connection.execute_batch(MIGRATION_0003)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (3)", [])?;
    }

    let migration_4_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 4)",
        [],
        |row| row.get(0),
    )?;

    if !migration_4_applied {
        connection.execute_batch(MIGRATION_0004)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (4)", [])?;
    }

    let migration_5_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 5)",
        [],
        |row| row.get(0),
    )?;

    if !migration_5_applied {
        connection.execute_batch(MIGRATION_0005)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (5)", [])?;
    }

    let migration_6_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 6)",
        [],
        |row| row.get(0),
    )?;

    if !migration_6_applied {
        connection.execute_batch(MIGRATION_0006)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (6)", [])?;
    }

    let migration_7_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 7)",
        [],
        |row| row.get(0),
    )?;

    if !migration_7_applied {
        connection.execute_batch(MIGRATION_0007)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (7)", [])?;
    }

    let migration_8_applied: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 8)",
        [],
        |row| row.get(0),
    )?;

    if !migration_8_applied {
        connection.execute_batch(MIGRATION_0008)?;
        connection.execute("INSERT INTO schema_migrations (version) VALUES (8)", [])?;
    }

    Ok(())
}
