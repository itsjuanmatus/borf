use super::migrations::{configure_main_connection, configure_search_connection, run_migrations};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
pub struct Database {
    pub(super) connection: Mutex<Connection>,
    pub(super) search_connection: Option<Mutex<Connection>>,
    pub(super) artwork_dir: PathBuf,
}

impl Database {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("failed to create app data dir: {error}"))?;

        let db_path = app_data_dir.join("borf.db");
        let connection = Connection::open(&db_path)
            .map_err(|error| format!("failed to open sqlite database: {error}"))?;

        configure_main_connection(&connection)?;

        run_migrations(&connection)
            .map_err(|error| format!("failed to run migrations: {error}"))?;

        let search_connection =
            Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| format!("failed to open sqlite search connection: {error}"))?;
        configure_search_connection(&search_connection)?;

        let cache_dir = app_handle
            .path()
            .app_cache_dir()
            .map_err(|error| format!("failed to resolve app cache dir: {error}"))?;
        let artwork_dir = cache_dir.join("artwork");
        fs::create_dir_all(&artwork_dir)
            .map_err(|error| format!("failed to create artwork cache dir: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
            search_connection: Some(Mutex::new(search_connection)),
            artwork_dir,
        })
    }

    pub(super) fn lock_search_connection(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        if let Some(search_connection) = &self.search_connection {
            return search_connection
                .lock()
                .map_err(|_| String::from("failed to lock search database connection"));
        }

        self.connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))
    }

    pub fn artwork_dir(&self) -> PathBuf {
        self.artwork_dir.clone()
    }
}
