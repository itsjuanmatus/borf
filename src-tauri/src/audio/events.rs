use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioStateEvent {
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioPositionEvent {
    pub current_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioTrackEndedEvent {
    pub song_id: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioErrorEvent {
    pub message: String,
}
