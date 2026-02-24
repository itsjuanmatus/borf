# Backend Module Ownership

This backend is split by domain so new code lands in the owning module instead of `mod.rs` catch-alls.

## Commands (`src-tauri/src/commands`)
- `library.rs`: library scan/query/search + song metadata commands.
- `tags.rs`: tag CRUD/assignment commands.
- `playlists.rs`: playlist and playlist-track commands.
- `imports.rs`: iTunes import entrypoints.
- `audio.rs`: playback control commands.
- `history.rs`: play-history commands.
- `stats.rs`: dashboard stats commands.
- `exports.rs`: export commands (M3U8/CSV/Markdown).
- `media_controls.rs`: OS media controls metadata updates.
- `mod.rs`: re-export facade; keep command names stable for `lib.rs`.

## Database (`src-tauri/src/db`)
- `models.rs`: shared DB-facing data structs/enums.
- `database.rs`: `Database` struct + connection/bootstrap helpers.
- `migrations.rs`: sqlite migration/version management.
- `songs.rs`: song upsert/read/playback lookup and missing-file handling.
- `tags.rs`: tag CRUD + song/tag assignment logic.
- `playlists.rs`: playlist tree + track ordering/containment logic.
- `search.rs`: library search + command-palette ranking.
- `settings.rs`: app settings and library roots persistence.
- `itunes_import.rs`: iTunes apply/update transaction path.
- `history.rs`: play history writes and paging.
- `stats.rs`: dashboard aggregations.
- `exports.rs`: export row builders + CSV helpers.
- `utils.rs`: shared DB helper routines used across domains.
- `tests/`: domain-split unit tests.
- `mod.rs`: compatibility facade with stable public re-exports.

## Audio (`src-tauri/src/audio`)
- `events.rs`: emitted audio payload types.
- `engine.rs`: public `AudioEngine` API + worker restart/retry behavior.
- `worker.rs`: audio thread lifecycle and command loop.
- `playback.rs`: play/pause/resume/seek handlers and sink lifecycle.
- `cache.rs`: decoded-track cache + decoded source iterator.
- `decode.rs`: streaming and symphonia decode paths.
- `tests.rs`: audio unit tests.

## Imports (`src-tauri/src/imports/itunes`)
- `types.rs`: import options, summaries, and internal parse/match types.
- `parser.rs`: plist parsing into internal structures.
- `matcher.rs`: song matching + rating/path normalization helpers.
- `progress.rs`: progress event emission helpers.
- `mod.rs`: stable public import API (`preview_itunes_import`, `run_itunes_import`).
- `tests.rs`: parser/matcher tests.

## Placement Rules
- Keep frontend contract and Tauri command names stable.
- Add new SQL/data-shape logic in the corresponding DB domain file.
- Add new command handlers in the matching `commands/*` domain file.
- Add new audio behavior in `audio/*` internals while keeping `AudioEngine` stable.
- Keep `mod.rs` files thin facades (module wiring + re-exports).
