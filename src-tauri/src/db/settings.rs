use super::utils::normalize_string_ids;
use super::*;
use rusqlite::{params, OptionalExtension};

const LIBRARY_ROOTS_SETTING_KEY: &str = "library_roots";

impl Database {
    pub fn get_library_roots(&self) -> Result<Vec<String>, String> {
        let raw = self.get_setting(LIBRARY_ROOTS_SETTING_KEY)?;
        let Some(raw) = raw else {
            return Ok(Vec::new());
        };

        let parsed = serde_json::from_str::<LibraryRootsSetting>(&raw)
            .or_else(|_| {
                serde_json::from_str::<Vec<String>>(&raw).map(|roots| LibraryRootsSetting { roots })
            })
            .map_err(|error| format!("failed to decode library roots setting: {error}"))?;

        Ok(normalize_string_ids(&parsed.roots))
    }

    pub fn set_library_roots(&self, roots: &[String]) -> Result<(), String> {
        let payload = LibraryRootsSetting {
            roots: normalize_string_ids(roots),
        };
        let encoded = serde_json::to_string(&payload)
            .map_err(|error| format!("failed to encode library roots setting: {error}"))?;
        self.set_setting(LIBRARY_ROOTS_SETTING_KEY, &encoded)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .execute(
                "
                INSERT INTO settings (key, value)
                VALUES (?1, ?2)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value
                ",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|error| format!("failed to set setting {key}: {error}"))
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| String::from("failed to lock database connection"))?;

        connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to read setting {key}: {error}"))
    }

    pub fn get_volume(&self) -> Result<f32, String> {
        let raw = self.get_setting("volume")?;
        match raw {
            Some(value) => value
                .parse::<f32>()
                .map(|parsed| parsed.clamp(0.0, 1.0))
                .map_err(|error| format!("invalid persisted volume value: {error}")),
            None => Ok(0.8),
        }
    }
}
