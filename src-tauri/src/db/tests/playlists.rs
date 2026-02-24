use super::{seed_song, test_db};
use rusqlite::params;

#[test]
fn creates_nested_playlists_with_contiguous_sort_order() {
    let db = test_db();

    let root_a = db
        .playlist_create("Root A", None, false)
        .expect("failed to create root playlist");
    let root_b = db
        .playlist_create("Root B", None, true)
        .expect("failed to create root folder");
    let child_a = db
        .playlist_create("Child A", Some(&root_b.id), false)
        .expect("failed to create child playlist");
    let child_b = db
        .playlist_create("Child B", Some(&root_b.id), false)
        .expect("failed to create child playlist");

    assert_eq!(root_a.sort_order, 0);
    assert_eq!(root_b.sort_order, 1);
    assert_eq!(child_a.sort_order, 0);
    assert_eq!(child_b.sort_order, 1);

    db.playlist_delete(&child_a.id)
        .expect("failed to delete child playlist");

    let children_after_delete = db
        .playlist_list()
        .expect("failed to list playlists")
        .into_iter()
        .filter(|node| node.parent_id.as_deref() == Some(root_b.id.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(children_after_delete.len(), 1);
    assert_eq!(children_after_delete[0].id, child_b.id);
    assert_eq!(children_after_delete[0].sort_order, 0);
}

#[test]
fn auto_suffixes_duplicate_playlist_names_on_create_and_rename() {
    let db = test_db();

    let first = db
        .playlist_create("Mix", None, false)
        .expect("failed to create first playlist");
    let second = db
        .playlist_create("Mix", None, false)
        .expect("failed to create second playlist");
    let third = db
        .playlist_create("Mix", None, false)
        .expect("failed to create third playlist");

    assert_eq!(first.name, "Mix");
    assert_eq!(second.name, "Mix (2)");
    assert_eq!(third.name, "Mix (3)");

    let renamed = db
        .playlist_rename(&second.id, "Mix")
        .expect("failed to rename playlist");
    assert_eq!(renamed.name, "Mix (2)");
}

#[test]
fn prevents_playlist_move_cycles_and_reorders_siblings() {
    let db = test_db();

    let folder_a = db
        .playlist_create("Folder A", None, true)
        .expect("failed to create folder a");
    let folder_b = db
        .playlist_create("Folder B", Some(&folder_a.id), true)
        .expect("failed to create folder b");
    let playlist = db
        .playlist_create("Playlist", Some(&folder_b.id), false)
        .expect("failed to create playlist");

    let cycle_error = db
        .playlist_move(&folder_a.id, Some(&folder_b.id), 0)
        .expect_err("expected cycle prevention error");
    assert!(cycle_error.contains("descendants"));

    db.playlist_move(&playlist.id, None, 0)
        .expect("failed to move playlist to root");

    let moved = db
        .playlist_list()
        .expect("failed to list playlists")
        .into_iter()
        .find(|node| node.id == playlist.id)
        .expect("failed to find moved playlist");
    assert_eq!(moved.parent_id, None);
    assert_eq!(moved.sort_order, 0);
}

#[test]
fn duplicates_playlist_with_song_order() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");

    let playlist = db
        .playlist_create("Roadtrip", None, false)
        .expect("failed to create playlist");
    db.playlist_add_songs(
        &playlist.id,
        &[String::from("song-1"), String::from("song-2")],
        None,
    )
    .expect("failed to add playlist songs");

    let duplicated = db
        .playlist_duplicate(&playlist.id)
        .expect("failed to duplicate playlist");
    assert_eq!(duplicated.name, "Roadtrip (2)");

    let tracks = db
        .playlist_get_tracks(&duplicated.id)
        .expect("failed to get duplicated tracks");
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0].song.id, "song-1");
    assert_eq!(tracks[1].song.id, "song-2");
    assert_eq!(tracks[0].position, 0);
    assert_eq!(tracks[1].position, 1);
}

#[test]
fn add_remove_and_reorder_tracks_keep_positions_contiguous() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");
    seed_song(&db, "song-3", "Song 3");
    seed_song(&db, "song-4", "Song 4");

    let playlist = db
        .playlist_create("Workout", None, false)
        .expect("failed to create playlist");

    let added = db
        .playlist_add_songs(
            &playlist.id,
            &[
                String::from("song-1"),
                String::from("song-2"),
                String::from("song-2"),
                String::from("song-3"),
                String::from("missing-song"),
            ],
            None,
        )
        .expect("failed to add songs");
    assert_eq!(added.affected, 3);

    db.playlist_add_songs(&playlist.id, &[String::from("song-4")], Some(1))
        .expect("failed to insert song at index");

    let tracks_after_insert = db
        .playlist_get_tracks(&playlist.id)
        .expect("failed to list tracks after insert");
    assert_eq!(
        tracks_after_insert
            .iter()
            .map(|track| track.song.id.as_str())
            .collect::<Vec<_>>(),
        vec!["song-1", "song-4", "song-2", "song-3"]
    );
    assert_eq!(
        tracks_after_insert
            .iter()
            .map(|track| track.position)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );

    db.playlist_remove_songs(&playlist.id, &[String::from("song-2")])
        .expect("failed to remove song");
    db.playlist_reorder_tracks(
        &playlist.id,
        &[String::from("song-3"), String::from("song-1")],
    )
    .expect("failed to reorder tracks");

    let tracks_after_reorder = db
        .playlist_get_tracks(&playlist.id)
        .expect("failed to list tracks after reorder");
    assert_eq!(
        tracks_after_reorder
            .iter()
            .map(|track| track.song.id.as_str())
            .collect::<Vec<_>>(),
        vec!["song-3", "song-1", "song-4"]
    );
    assert_eq!(
        tracks_after_reorder
            .iter()
            .map(|track| track.position)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn playlist_track_paging_count_and_ids_respect_order_and_missing_songs() {
    let db = test_db();
    seed_song(&db, "song-1", "Song 1");
    seed_song(&db, "song-2", "Song 2");
    seed_song(&db, "song-3", "Song 3");
    seed_song(&db, "song-4", "Song 4");

    let playlist = db
        .playlist_create("Paged", None, false)
        .expect("failed to create playlist");
    db.playlist_add_songs(
        &playlist.id,
        &[
            String::from("song-1"),
            String::from("song-2"),
            String::from("song-3"),
            String::from("song-4"),
        ],
        None,
    )
    .expect("failed to seed playlist tracks");

    {
        let connection = db.connection.lock().expect("failed to lock db");
        connection
            .execute(
                "UPDATE songs SET is_missing = 1 WHERE id = ?1",
                params!["song-3"],
            )
            .expect("failed to mark song missing");
    }

    let count = db
        .playlist_get_track_count(&playlist.id)
        .expect("failed to count playlist tracks");
    assert_eq!(count, 3);

    let page_0 = db
        .playlist_get_tracks_page(&playlist.id, 2, 0)
        .expect("failed to fetch page 0");
    assert_eq!(
        page_0
            .iter()
            .map(|track| track.song.id.as_str())
            .collect::<Vec<_>>(),
        vec!["song-1", "song-2"]
    );

    let page_1 = db
        .playlist_get_tracks_page(&playlist.id, 2, 2)
        .expect("failed to fetch page 1");
    assert_eq!(page_1.len(), 1);
    assert_eq!(page_1[0].song.id, "song-4");
    assert_eq!(page_1[0].position, 3);

    let ordered_ids = db
        .playlist_get_track_ids(&playlist.id)
        .expect("failed to load ordered track ids");
    assert_eq!(
        ordered_ids,
        vec![
            String::from("song-1"),
            String::from("song-2"),
            String::from("song-4")
        ]
    );
}
