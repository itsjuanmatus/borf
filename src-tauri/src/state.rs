use crate::{audio::AudioEngine, db::Database};
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    pub audio: Arc<AudioEngine>,
}

impl AppState {
    pub fn new(db: Arc<Database>, audio: Arc<AudioEngine>) -> Self {
        Self { db, audio }
    }
}
