use super::{scan_song_file, supported_audio_file};
use crate::db::{Database, DbSongUpsert};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const WATCHER_POLL_TIMEOUT: Duration = Duration::from_millis(250);
const WATCHER_DEBOUNCE_WINDOW: Duration = Duration::from_secs(2);
const WATCHER_BULK_CHANGE_PATH_THRESHOLD: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LibraryChangeScope {
    File,
    Directory,
    Bulk,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryFileChangedEvent {
    pub changed_paths: Vec<String>,
    pub reason: String,
    pub change_scope: LibraryChangeScope,
}

enum WatcherCommand {
    WatchRoot(PathBuf),
}

#[derive(Clone)]
pub struct LibraryWatcher {
    command_tx: Arc<Mutex<Sender<WatcherCommand>>>,
}

impl LibraryWatcher {
    pub fn new(app_handle: AppHandle, db: Arc<Database>) -> Result<Self, String> {
        let (command_tx, command_rx) = mpsc::channel::<WatcherCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        thread::spawn(move || {
            run_watcher_thread(app_handle, db, command_rx, ready_tx);
        });

        ready_rx
            .recv()
            .map_err(|error| format!("watcher thread failed to start: {error}"))??;

        Ok(Self {
            command_tx: Arc::new(Mutex::new(command_tx)),
        })
    }

    pub fn watch_root(&self, root: PathBuf) -> Result<(), String> {
        let sender = self
            .command_tx
            .lock()
            .map_err(|_| String::from("failed to lock watcher command sender"))?
            .clone();
        sender
            .send(WatcherCommand::WatchRoot(root))
            .map_err(|error| format!("failed to send watcher command: {error}"))
    }
}

fn run_watcher_thread(
    app_handle: AppHandle,
    db: Arc<Database>,
    command_rx: Receiver<WatcherCommand>,
    ready_tx: Sender<Result<(), String>>,
) {
    let (notify_tx, notify_rx) = mpsc::channel::<Result<notify::Event, notify::Error>>();
    let mut watcher = match build_watcher(notify_tx) {
        Ok(watcher) => {
            let _ = ready_tx.send(Ok(()));
            watcher
        }
        Err(error) => {
            let _ = ready_tx.send(Err(error));
            return;
        }
    };

    let mut watched_roots = HashSet::<String>::new();
    let mut pending_paths = HashSet::<String>::new();
    let mut pending_reasons = HashSet::<String>::new();
    let mut last_event_at: Option<Instant> = None;

    loop {
        while let Ok(command) = command_rx.try_recv() {
            match command {
                WatcherCommand::WatchRoot(root) => {
                    if !root.exists() || !root.is_dir() {
                        continue;
                    }

                    let canonical = std::fs::canonicalize(&root).unwrap_or(root.clone());
                    let root_key = canonical.to_string_lossy().to_string();
                    if watched_roots.contains(&root_key) {
                        continue;
                    }

                    match watcher.watch(canonical.as_path(), RecursiveMode::Recursive) {
                        Ok(()) => {
                            watched_roots.insert(root_key);
                        }
                        Err(error) => {
                            log::warn!(
                                "failed to start watching root {}: {}",
                                canonical.display(),
                                error
                            );
                        }
                    }
                }
            }
        }

        match notify_rx.recv_timeout(WATCHER_POLL_TIMEOUT) {
            Ok(event_result) => match event_result {
                Ok(event) => {
                    pending_reasons.insert(reason_from_kind(&event.kind).to_string());
                    for path in event.paths {
                        pending_paths.insert(path.to_string_lossy().to_string());
                    }
                    last_event_at = Some(Instant::now());
                }
                Err(error) => {
                    log::warn!("file watcher event error: {error}");
                }
            },
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                log::warn!("file watcher channel disconnected");
                break;
            }
        }

        let should_flush = !pending_paths.is_empty()
            && last_event_at
                .map(|last| last.elapsed() >= WATCHER_DEBOUNCE_WINDOW)
                .unwrap_or(false);
        if should_flush {
            if let Err(error) =
                apply_pending_changes(&app_handle, &db, &pending_paths, &pending_reasons)
            {
                log::warn!("failed to apply watched file changes: {error}");
            }
            pending_paths.clear();
            pending_reasons.clear();
            last_event_at = None;
        }
    }
}

fn build_watcher(
    notify_tx: Sender<Result<notify::Event, notify::Error>>,
) -> Result<RecommendedWatcher, String> {
    notify::recommended_watcher(move |result| {
        let _ = notify_tx.send(result);
    })
    .map_err(|error| format!("failed to build file watcher: {error}"))
}

fn apply_pending_changes(
    app_handle: &AppHandle,
    db: &Database,
    pending_paths: &HashSet<String>,
    pending_reasons: &HashSet<String>,
) -> Result<(), String> {
    let mut upserts = Vec::<DbSongUpsert>::new();
    let mut missing_paths = Vec::<String>::new();
    let mut saw_directory_path = false;
    let artwork_dir = db.artwork_dir();

    for raw_path in pending_paths {
        let path = PathBuf::from(raw_path);
        if path.exists() {
            if path.is_file() {
                if !supported_audio_file(path.as_path()) {
                    continue;
                }

                match scan_song_file(path.as_path(), artwork_dir.as_path()) {
                    Ok(Some(song)) => upserts.push(song),
                    Ok(None) => {}
                    Err(error) => {
                        log::warn!(
                            "watcher failed to scan changed file {}: {error}",
                            path.display()
                        )
                    }
                }
                continue;
            }

            if path.is_dir() {
                saw_directory_path = true;
                continue;
            }
        } else {
            if path.extension().is_none() {
                saw_directory_path = true;
            }
            missing_paths.push(raw_path.clone());
        }
    }

    if !upserts.is_empty() {
        db.upsert_songs(&upserts)?;
    }
    if !missing_paths.is_empty() {
        let _ = db.mark_songs_missing_by_paths(&missing_paths)?;
    }

    if upserts.is_empty() && missing_paths.is_empty() && !saw_directory_path {
        return Ok(());
    }

    let mut changed_paths = pending_paths.iter().cloned().collect::<Vec<_>>();
    changed_paths.sort();
    changed_paths.dedup();

    let reason = if pending_reasons.is_empty() {
        String::from("changed")
    } else {
        let mut reasons = pending_reasons.iter().cloned().collect::<Vec<_>>();
        reasons.sort();
        reasons.join(",")
    };

    let change_scope = classify_change_scope(changed_paths.len(), saw_directory_path);

    let _ = app_handle.emit(
        "library:file-changed",
        LibraryFileChangedEvent {
            changed_paths,
            reason,
            change_scope,
        },
    );

    Ok(())
}

fn reason_from_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "added",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(_) => "removed",
        _ => "changed",
    }
}

fn classify_change_scope(path_count: usize, saw_directory_path: bool) -> LibraryChangeScope {
    if path_count >= WATCHER_BULK_CHANGE_PATH_THRESHOLD {
        return LibraryChangeScope::Bulk;
    }
    if saw_directory_path {
        return LibraryChangeScope::Directory;
    }
    LibraryChangeScope::File
}

#[cfg(test)]
mod tests {
    use super::{classify_change_scope, reason_from_kind, LibraryChangeScope};
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    use notify::EventKind;

    #[test]
    fn maps_event_kinds_to_expected_reason_labels() {
        assert_eq!(
            reason_from_kind(&EventKind::Create(CreateKind::File)),
            "added"
        );
        assert_eq!(
            reason_from_kind(&EventKind::Modify(ModifyKind::Any)),
            "modified"
        );
        assert_eq!(
            reason_from_kind(&EventKind::Remove(RemoveKind::Any)),
            "removed"
        );
        assert_eq!(reason_from_kind(&EventKind::Any), "changed");
    }

    #[test]
    fn classifies_bulk_changes_when_path_count_is_large() {
        assert_eq!(classify_change_scope(64, false), LibraryChangeScope::Bulk);
        assert_eq!(classify_change_scope(120, true), LibraryChangeScope::Bulk);
    }

    #[test]
    fn classifies_directory_changes_when_directory_paths_are_present() {
        assert_eq!(
            classify_change_scope(3, true),
            LibraryChangeScope::Directory
        );
        assert_eq!(classify_change_scope(3, false), LibraryChangeScope::File);
    }
}
