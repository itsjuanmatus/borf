use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct MediaControlsManager {
    controls: Mutex<Option<MediaControls>>,
}

impl MediaControlsManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let config = PlatformConfig {
            dbus_name: "borf",
            display_name: "Borf",
            hwnd: None,
        };

        let controls = match MediaControls::new(config) {
            Ok(mut mc) => {
                let handle = app_handle.clone();
                let _ = mc.attach(move |event: MediaControlEvent| match event {
                    MediaControlEvent::Toggle => {
                        let _ = handle.emit("mediakey:toggle", ());
                    }
                    MediaControlEvent::Play => {
                        let _ = handle.emit("mediakey:play", ());
                    }
                    MediaControlEvent::Pause => {
                        let _ = handle.emit("mediakey:pause", ());
                    }
                    MediaControlEvent::Next => {
                        let _ = handle.emit("mediakey:next", ());
                    }
                    MediaControlEvent::Previous => {
                        let _ = handle.emit("mediakey:previous", ());
                    }
                    _ => {}
                });
                Some(mc)
            }
            Err(error) => {
                log::warn!("Failed to initialize media controls: {error:?}");
                None
            }
        };

        Self {
            controls: Mutex::new(controls),
        }
    }

    pub fn update_metadata(
        &self,
        title: Option<&str>,
        artist: Option<&str>,
        album: Option<&str>,
        duration_ms: Option<u64>,
    ) {
        if let Ok(mut guard) = self.controls.lock() {
            if let Some(controls) = guard.as_mut() {
                let duration = duration_ms.map(|ms| std::time::Duration::from_millis(ms));
                let _ = controls.set_metadata(MediaMetadata {
                    title,
                    artist,
                    album,
                    duration,
                    ..Default::default()
                });
            }
        }
    }

    pub fn set_playing(&self, playing: bool) {
        if let Ok(mut guard) = self.controls.lock() {
            if let Some(controls) = guard.as_mut() {
                let playback = if playing {
                    MediaPlayback::Playing { progress: None }
                } else {
                    MediaPlayback::Paused { progress: None }
                };
                let _ = controls.set_playback(playback);
            }
        }
    }
}
