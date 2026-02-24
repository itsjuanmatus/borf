use super::events::AudioErrorEvent;
use super::worker::{spawn_audio_thread, AudioCommand};
use crate::db::SongPlaybackInfo;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
pub struct AudioEngine {
    app_handle: AppHandle,
    command_tx: Arc<Mutex<Sender<AudioCommand>>>,
    last_volume: Arc<Mutex<f32>>,
}

impl AudioEngine {
    pub fn new(app_handle: AppHandle, initial_volume: f32) -> Result<Self, String> {
        let clamped_volume = initial_volume.clamp(0.0, 1.0);
        let command_tx = spawn_audio_thread(app_handle.clone(), clamped_volume)?;

        Ok(Self {
            app_handle,
            command_tx: Arc::new(Mutex::new(command_tx)),
            last_volume: Arc::new(Mutex::new(clamped_volume)),
        })
    }

    pub fn play(&self, song: SongPlaybackInfo, start_ms: Option<u64>) -> Result<(), String> {
        self.send_command_with_retry(
            move |response| AudioCommand::Play {
                song: song.clone(),
                start_ms,
                response,
            },
            "play",
        )
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send_command_with_retry(|response| AudioCommand::Pause { response }, "pause")
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send_command_with_retry(|response| AudioCommand::Resume { response }, "resume")
    }

    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        self.send_command_with_retry(
            move |response| AudioCommand::Seek {
                position_ms,
                response,
            },
            "seek",
        )
    }

    pub fn set_volume(&self, volume: f32) -> Result<f32, String> {
        let clamped = volume.clamp(0.0, 1.0);

        self.send_command_with_retry(
            move |response| AudioCommand::SetVolume {
                volume: clamped,
                response,
            },
            "set-volume",
        )?;

        let mut volume_guard = self
            .last_volume
            .lock()
            .map_err(|_| String::from("failed to lock audio volume state"))?;
        *volume_guard = clamped;

        Ok(clamped)
    }

    pub fn clear_decoded_cache(&self) -> Result<(), String> {
        self.send_command_with_retry(
            |response| AudioCommand::ClearDecodedCache { response },
            "clear-decoded-cache",
        )
    }

    pub fn emit_error(app_handle: &AppHandle, message: impl Into<String>) {
        let _ = app_handle.emit(
            "audio:error",
            AudioErrorEvent {
                message: message.into(),
            },
        );
    }

    fn send_command_with_retry<F>(
        &self,
        mut command_builder: F,
        command_label: &str,
    ) -> Result<(), String>
    where
        F: FnMut(Sender<Result<(), String>>) -> AudioCommand,
    {
        for attempt in 0..2 {
            let (response_tx, response_rx) = mpsc::channel();
            let sender = {
                let sender_guard = self
                    .command_tx
                    .lock()
                    .map_err(|_| String::from("failed to lock audio command sender"))?;
                sender_guard.clone()
            };

            if let Err(error) = sender.send(command_builder(response_tx)) {
                if attempt == 0 {
                    log::warn!(
                        "audio worker channel closed while sending {} command: {}; attempting restart",
                        command_label,
                        error
                    );
                    self.restart_worker()?;
                    continue;
                }

                return Err(format!("failed to send {command_label} command: {error}"));
            }

            match response_rx.recv() {
                Ok(result) => {
                    return result;
                }
                Err(error) => {
                    if attempt == 0 {
                        log::warn!(
                            "audio worker terminated while waiting for {} response: {}; attempting restart",
                            command_label,
                            error
                        );
                        self.restart_worker()?;
                        continue;
                    }

                    return Err(format!(
                        "failed to receive {command_label} command response: {error}"
                    ));
                }
            }
        }

        Err(format!(
            "audio worker unavailable after restart while running {command_label}"
        ))
    }

    fn restart_worker(&self) -> Result<(), String> {
        let last_volume = *self
            .last_volume
            .lock()
            .map_err(|_| String::from("failed to lock audio volume state"))?;

        let next_sender = spawn_audio_thread(self.app_handle.clone(), last_volume)?;

        let mut sender_guard = self
            .command_tx
            .lock()
            .map_err(|_| String::from("failed to lock audio command sender"))?;
        *sender_guard = next_sender;

        Ok(())
    }
}
