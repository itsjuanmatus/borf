pub mod watcher;

pub use watcher::LibraryWatcher;

use crate::db::{to_sqlite_timestamp, Database, DbSongUpsert};
use chrono::{DateTime, Utc};
use lofty::file::TaggedFile;
use lofty::prelude::{Accessor, AudioFile, ItemKey, TaggedFileExt};
use lofty::probe::Probe;
use serde::Serialize;
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use walkdir::WalkDir;

const BATCH_SIZE: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgressEvent {
    pub scanned: usize,
    pub total: usize,
    pub current_file: String,
}

pub fn supported_audio_file(path: &Path) -> bool {
    static SUPPORTED_EXTENSIONS: &[&str] =
        &["mp3", "flac", "m4a", "aac", "wav", "ogg", "aiff", "alac"];

    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| supported.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

pub fn scan_library(
    app_handle: &AppHandle,
    db: &Database,
    folder_path: &Path,
) -> Result<(), String> {
    if !folder_path.exists() {
        return Err(format!("folder does not exist: {}", folder_path.display()));
    }

    if !folder_path.is_dir() {
        return Err(format!(
            "path is not a directory: {}",
            folder_path.display()
        ));
    }

    let all_audio_files = collect_audio_files(folder_path);
    let total = all_audio_files.len();

    let mut batch: Vec<DbSongUpsert> = Vec::with_capacity(BATCH_SIZE);

    for (index, audio_path) in all_audio_files.iter().enumerate() {
        match scan_song_file(audio_path, &db.artwork_dir()) {
            Ok(Some(song)) => {
                batch.push(song);
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!(
                    "skipping unreadable file {}: {}",
                    audio_path.display(),
                    error
                );
            }
        }

        if batch.len() >= BATCH_SIZE {
            db.upsert_songs(&batch)?;
            batch.clear();
        }

        let _ = app_handle.emit(
            "library:scan-progress",
            ScanProgressEvent {
                scanned: index + 1,
                total,
                current_file: audio_path.to_string_lossy().to_string(),
            },
        );
    }

    if !batch.is_empty() {
        db.upsert_songs(&batch)?;
    }

    let _ = app_handle.emit(
        "library:scan-progress",
        ScanProgressEvent {
            scanned: total,
            total,
            current_file: String::from("Scan complete"),
        },
    );

    Ok(())
}

pub(crate) fn collect_audio_files(folder_path: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for entry in WalkDir::new(folder_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if supported_audio_file(path) {
            files.push(path.to_path_buf());
        }
    }

    files.sort();
    files
}

pub(crate) fn scan_song_file(
    path: &Path,
    artwork_dir: &Path,
) -> Result<Option<DbSongUpsert>, String> {
    if !supported_audio_file(path) {
        return Ok(None);
    }

    let tagged_file = Probe::open(path)
        .map_err(|error| format!("failed to open file for metadata parsing: {error}"))?
        .guess_file_type()
        .map_err(|error| format!("failed to guess file type: {error}"))?
        .read()
        .map_err(|error| format!("failed to parse metadata: {error}"))?;

    Ok(Some(build_song_record(path, artwork_dir, tagged_file)?))
}

fn build_song_record(
    path: &Path,
    artwork_dir: &Path,
    tagged_file: TaggedFile,
) -> Result<DbSongUpsert, String> {
    let song_id = Uuid::new_v4().to_string();
    let primary_tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = normalize_field(
        primary_tag
            .and_then(|tag| tag.title())
            .map(|value| value.into_owned()),
        "Unknown",
    );
    let artist = normalize_field(
        primary_tag
            .and_then(|tag| tag.artist())
            .map(|value| value.into_owned()),
        "Unknown Artist",
    );
    let album = normalize_field(
        primary_tag
            .and_then(|tag| tag.album())
            .map(|value| value.into_owned()),
        "Unknown Album",
    );
    let album_artist = normalize_optional(
        primary_tag
            .and_then(|tag| tag.get_string(ItemKey::AlbumArtist))
            .map(String::from),
    );
    let genre = normalize_optional(
        primary_tag
            .and_then(|tag| tag.genre())
            .map(|value| value.into_owned()),
    );

    let track_number = primary_tag.and_then(|tag| tag.track()).map(i64::from);
    let disc_number = primary_tag
        .and_then(|tag| tag.disk())
        .map(i64::from)
        .unwrap_or(1);
    let year = primary_tag
        .and_then(|tag| tag.date())
        .map(|date| i64::from(date.year));

    let properties = tagged_file.properties();
    let duration_ms = i64::try_from(properties.duration().as_millis()).unwrap_or(0);
    let bitrate = properties.audio_bitrate().map(i64::from);
    let sample_rate = properties.sample_rate().map(i64::from);

    let codec = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());

    let file_modified_at = fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from)
        .map(to_sqlite_timestamp);

    let artwork_path = extract_artwork(&tagged_file, artwork_dir, &song_id)?;

    let mut hash_builder = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hash_builder);
    let file_hash = Some(format!("{:x}", hash_builder.finish()));

    Ok(DbSongUpsert {
        id: song_id,
        file_path: path.to_string_lossy().to_string(),
        file_hash,
        title,
        artist,
        album_artist,
        album,
        track_number,
        disc_number,
        year,
        genre,
        duration_ms,
        codec,
        bitrate,
        sample_rate,
        artwork_path,
        file_modified_at,
    })
}

fn normalize_field(value: Option<String>, fallback: &str) -> String {
    normalize_optional(value).unwrap_or_else(|| String::from(fallback))
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn extract_artwork(
    tagged_file: &TaggedFile,
    artwork_dir: &Path,
    song_id: &str,
) -> Result<Option<String>, String> {
    let mut seen_hashes = HashSet::<u64>::new();

    for tag in tagged_file.tags() {
        for picture in tag.pictures() {
            let bytes = picture.data();
            if bytes.is_empty() {
                continue;
            }

            let picture_hash = fxhash(bytes);
            if seen_hashes.contains(&picture_hash) {
                continue;
            }
            seen_hashes.insert(picture_hash);

            let image = image::load_from_memory(bytes)
                .map_err(|error| format!("failed to decode artwork image: {error}"))?;

            let resized = image
                .resize_to_fill(200, 200, image::imageops::FilterType::CatmullRom)
                .to_rgba8();
            let (width, height) = resized.dimensions();

            let webp = webp::Encoder::from_rgba(resized.as_raw(), width, height).encode(80.0);
            let output_path = artwork_dir.join(format!("{song_id}.webp"));
            let webp_bytes: &[u8] = webp.as_ref();
            fs::write(&output_path, webp_bytes)
                .map_err(|error| format!("failed to write artwork cache file: {error}"))?;

            return Ok(Some(output_path.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

fn fxhash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{normalize_field, normalize_optional, supported_audio_file};
    use std::path::Path;

    #[test]
    fn supports_expected_audio_extensions() {
        assert!(supported_audio_file(Path::new("song.mp3")));
        assert!(supported_audio_file(Path::new("song.FLAC")));
        assert!(supported_audio_file(Path::new("song.m4a")));
        assert!(supported_audio_file(Path::new("song.AIFF")));
        assert!(!supported_audio_file(Path::new("song.txt")));
        assert!(!supported_audio_file(Path::new("song")));
    }

    #[test]
    fn metadata_defaults_are_normalized() {
        assert_eq!(normalize_field(None, "Unknown"), "Unknown");
        assert_eq!(
            normalize_field(Some(String::from("  ")), "Unknown"),
            "Unknown"
        );
        assert_eq!(
            normalize_field(Some(String::from(" Song Name ")), "Unknown"),
            "Song Name"
        );

        assert_eq!(normalize_optional(None), None);
        assert_eq!(normalize_optional(Some(String::from("   "))), None);
        assert_eq!(
            normalize_optional(Some(String::from("Artist"))),
            Some(String::from("Artist"))
        );
    }
}
