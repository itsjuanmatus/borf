use super::types::{ParsedLibrary, ParsedPlaylist, ParsedTrack};
use plist::Value;
use std::path::Path;

pub(super) fn parse_itunes_library(xml_path: &Path) -> Result<ParsedLibrary, String> {
    let value = Value::from_file(xml_path).map_err(|error| {
        format!(
            "failed to parse iTunes plist at {}: {error}",
            xml_path.display()
        )
    })?;

    let root = value
        .as_dictionary()
        .ok_or_else(|| String::from("invalid iTunes plist format: root is not a dictionary"))?;

    let tracks_dict = root
        .get("Tracks")
        .and_then(Value::as_dictionary)
        .ok_or_else(|| String::from("invalid iTunes plist format: missing Tracks dictionary"))?;

    let mut tracks = Vec::new();
    for (track_key, track_value) in tracks_dict {
        let Some(track_dictionary) = track_value.as_dictionary() else {
            continue;
        };

        let track_id = track_dictionary
            .get("Track ID")
            .and_then(value_as_i64)
            .or_else(|| track_key.parse::<i64>().ok())
            .unwrap_or_default();

        let title = normalize_string(
            track_dictionary.get("Name").and_then(Value::as_string),
            "Unknown",
        );
        let artist = normalize_string(
            track_dictionary.get("Artist").and_then(Value::as_string),
            "Unknown Artist",
        );

        let duration_ms = track_dictionary.get("Total Time").and_then(value_as_i64);
        let location = track_dictionary
            .get("Location")
            .and_then(Value::as_string)
            .map(String::from);

        let rating = track_dictionary.get("Rating").and_then(value_as_i64);
        let rating_computed = track_dictionary
            .get("Rating Computed")
            .and_then(Value::as_boolean)
            .unwrap_or(false);

        let comments = track_dictionary
            .get("Comments")
            .and_then(Value::as_string)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());

        let date_added = track_dictionary
            .get("Date Added")
            .and_then(value_as_timestamp_string);
        let play_date_utc = track_dictionary
            .get("Play Date UTC")
            .and_then(value_as_timestamp_string);

        tracks.push(ParsedTrack {
            track_id,
            title,
            artist,
            duration_ms,
            location,
            play_count: track_dictionary.get("Play Count").and_then(value_as_i64),
            skip_count: track_dictionary.get("Skip Count").and_then(value_as_i64),
            rating,
            rating_computed,
            comments,
            date_added,
            play_date_utc,
        });
    }

    let playlists = root
        .get("Playlists")
        .and_then(Value::as_array)
        .map(|values| parse_playlists(values.as_slice()))
        .unwrap_or_default();

    Ok(ParsedLibrary { tracks, playlists })
}

pub(super) fn parse_playlists(values: &[Value]) -> Vec<ParsedPlaylist> {
    let mut playlists = Vec::new();

    for (index, value) in values.iter().enumerate() {
        let Some(dictionary) = value.as_dictionary() else {
            continue;
        };

        let name = normalize_string(
            dictionary.get("Name").and_then(Value::as_string),
            "Unnamed Playlist",
        );
        let is_folder = dictionary
            .get("Folder")
            .and_then(Value::as_boolean)
            .unwrap_or(false);
        let is_smart = dictionary.get("Smart Info").is_some();
        let is_system = dictionary
            .get("Master")
            .and_then(Value::as_boolean)
            .unwrap_or(false)
            || dictionary.contains_key("Distinguished Kind");

        let external_id = dictionary
            .get("Playlist Persistent ID")
            .and_then(Value::as_string)
            .map(str::to_string)
            .or_else(|| {
                dictionary
                    .get("Playlist ID")
                    .and_then(value_as_i64)
                    .map(|value| value.to_string())
            })
            .unwrap_or_else(|| format!("generated-playlist-{index}"));

        let parent_external_id = dictionary
            .get("Parent Persistent ID")
            .and_then(Value::as_string)
            .map(str::to_string)
            .or_else(|| {
                dictionary
                    .get("Parent Playlist ID")
                    .and_then(value_as_i64)
                    .map(|value| value.to_string())
            });

        let mut track_ids = Vec::new();
        if let Some(items) = dictionary.get("Playlist Items").and_then(Value::as_array) {
            for item in items {
                let Some(item_dictionary) = item.as_dictionary() else {
                    continue;
                };
                if let Some(track_id) = item_dictionary.get("Track ID").and_then(value_as_i64) {
                    track_ids.push(track_id);
                }
            }
        }

        playlists.push(ParsedPlaylist {
            external_id,
            parent_external_id,
            name,
            is_folder,
            sort_order: index as i64,
            is_smart,
            is_system,
            track_ids,
        });
    }

    playlists
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value.as_signed_integer().or_else(|| {
        value
            .as_unsigned_integer()
            .and_then(|raw| i64::try_from(raw).ok())
    })
}

fn value_as_timestamp_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_string() {
        return Some(text.to_owned());
    }

    value.as_date().map(|date| date.to_xml_format())
}

fn normalize_string(input: Option<&str>, fallback: &str) -> String {
    input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .unwrap_or_else(|| String::from(fallback))
}
