use crate::{audio::AudioEngine, db::Database, library::LibraryWatcher};
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub audio: Arc<AudioEngine>,
    pub library_watcher: Arc<LibraryWatcher>,
}

impl AppState {
    pub fn new(
        db: Arc<Database>,
        audio: Arc<AudioEngine>,
        library_watcher: Arc<LibraryWatcher>,
    ) -> Self {
        Self {
            db,
            audio,
            library_watcher,
        }
    }
}
