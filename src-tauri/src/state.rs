use crate::{
    audio::AudioEngine, db::Database, library::LibraryWatcher, media_controls::MediaControlsManager,
};
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub audio: Arc<AudioEngine>,
    pub library_watcher: Arc<LibraryWatcher>,
    pub media_controls: Arc<MediaControlsManager>,
}

impl AppState {
    pub fn new(
        db: Arc<Database>,
        audio: Arc<AudioEngine>,
        library_watcher: Arc<LibraryWatcher>,
        media_controls: Arc<MediaControlsManager>,
    ) -> Self {
        Self {
            db,
            audio,
            library_watcher,
            media_controls,
        }
    }
}
