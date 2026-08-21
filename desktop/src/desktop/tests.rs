use super::catalog::initialize_schema;
use super::model::{AssetKind, CameraMatchPreference, LibraryManifest};
use super::{
    DATABASE_FILE, DesktopState, Library, MARKER_FILE, parse_range, validate_storage_name,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;

#[test]
fn creates_and_reopens_a_managed_library() {
    let parent = tempfile::tempdir().unwrap();
    let library = Library::create(parent.path()).unwrap();
    let root = library.root.clone();
    assert!(root.join(MARKER_FILE).is_file());
    assert!(root.join(DATABASE_FILE).is_file());
    drop(library);
    assert!(Library::open(&root).is_ok());
}

#[test]
fn rejects_directories_without_a_marker() {
    let directory = tempfile::tempdir().unwrap();
    assert!(Library::open(directory.path()).is_err());
}

#[test]
fn storage_names_cannot_escape_the_library() {
    for invalid in ["../photo.raw", "/photo.raw", "PHOTO.raw", ".photo", "photo"] {
        assert!(
            validate_storage_name(invalid).is_err(),
            "accepted {invalid}"
        );
    }
    assert!(validate_storage_name("asset-123.cr3").is_ok());
}

#[test]
fn validates_byte_ranges() {
    assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
    assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
    assert_eq!(parse_range("bytes=1000-", 1000), None);
}

#[test]
fn round_trips_the_normalized_catalog() {
    let parent = tempfile::tempdir().unwrap();
    let mut library = Library::create(parent.path()).unwrap();
    let manifest = sample_manifest();
    library.save_library(&manifest).unwrap();
    let loaded = serde_json::to_value(library.load_library().unwrap().unwrap()).unwrap();
    let manifest = serde_json::to_value(manifest).unwrap();
    assert_eq!(loaded["photos"], manifest["photos"]);
    assert_eq!(loaded["collections"], manifest["collections"]);
    assert_eq!(loaded["stacks"], manifest["stacks"]);
    assert_eq!(loaded["cameraMatchPreference"], "ask");
}

#[test]
fn persists_the_camera_match_preference() {
    let parent = tempfile::tempdir().unwrap();
    let mut library = Library::create(parent.path()).unwrap();
    library.save_library(&sample_manifest()).unwrap();

    library
        .save_camera_match_preference(CameraMatchPreference::Never)
        .unwrap();

    let loaded = serde_json::to_value(library.load_library().unwrap().unwrap()).unwrap();
    assert_eq!(loaded["cameraMatchPreference"], "never");
}

#[test]
fn adds_camera_match_preference_to_existing_catalogs() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE library (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            INSERT INTO library (id, created_at, updated_at) VALUES (1, 1, 1);",
        )
        .unwrap();

    initialize_schema(&connection).unwrap();

    let preference = connection
        .query_row(
            "SELECT camera_match_preference FROM library WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    assert_eq!(preference, "ask");
}

#[test]
fn resolves_duplicate_imports_by_content_identity() {
    let parent = tempfile::tempdir().unwrap();
    let mut library = Library::create(parent.path()).unwrap();
    let manifest = sample_manifest();
    library.save_library(&manifest).unwrap();
    let mut duplicate = manifest.photos[0].clone();
    duplicate.id = "photo-copy".into();
    let display = duplicate.frames[0].display.as_mut().unwrap();
    display.id = "asset-copy".into();
    display.storage_name = "asset-copy.jpg".into();
    let resolution = library.resolve_imports(&[duplicate]).unwrap();
    assert!(resolution.additions.is_empty());
    assert_eq!(resolution.photo_ids["photo-copy"], "photo-one");
}

#[test]
fn fingerprints_match_the_browser_catalog() {
    let mut manifest = sample_manifest();
    manifest.photos[0].frames[0].filename_exposure_hint = Some(1.0);
    assert_eq!(
        manifest.photos[0].fingerprint(),
        "display|:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1"
    );
}

#[test]
fn commits_verified_asset_writes() {
    let parent = tempfile::tempdir().unwrap();
    let config = tempfile::tempdir().unwrap();
    let state = DesktopState::new(config.path().to_owned());
    let root = state.create_library(parent.path()).unwrap();
    let bytes = b"postframe";
    let hash = format!("{:x}", Sha256::digest(bytes));
    let token = state
        .begin_asset_write(
            AssetKind::Originals,
            "asset-one.jpg",
            bytes.len() as u64,
            Some(hash),
        )
        .unwrap();

    state.append_write(&token, 0, bytes).unwrap();
    state.commit_write(&token).unwrap();

    assert_eq!(
        fs::read(std::path::Path::new(&root).join("originals/asset-one.jpg")).unwrap(),
        bytes
    );
}

#[test]
fn rejects_incomplete_asset_writes() {
    let parent = tempfile::tempdir().unwrap();
    let config = tempfile::tempdir().unwrap();
    let state = DesktopState::new(config.path().to_owned());
    let root = state.create_library(parent.path()).unwrap();
    let token = state
        .begin_asset_write(AssetKind::Originals, "asset-one.jpg", 4, None)
        .unwrap();

    state.append_write(&token, 0, b"no").unwrap();

    assert!(state.commit_write(&token).is_err());
    assert!(
        !std::path::Path::new(&root)
            .join("originals/asset-one.jpg")
            .exists()
    );
}

fn sample_manifest() -> LibraryManifest {
    serde_json::from_value(json!({
        "version": 1,
        "createdAt": 10,
        "updatedAt": 20,
        "photos": [{
            "id": "photo-one",
            "kind": "display",
            "name": "photo.jpg",
            "importedAt": 11,
            "frames": [{
                "raw": null,
                "display": {
                    "id": "asset-one",
                    "storageName": "asset-one.jpg",
                    "name": "photo.jpg",
                    "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "source": {
                        "kind": "image",
                        "format": "jpg",
                        "mediaType": "image/jpeg",
                        "size": 4,
                        "lastModified": 1
                    }
                },
                "filenameExposureHint": null
            }],
            "bracketDetection": null,
            "thumbnailStorageName": "photo-one.jpg",
            "metadata": null,
            "width": 2,
            "height": 2,
            "rating": 0,
            "flagged": false,
            "rejected": false,
            "colorLabel": "none",
            "stackId": "stack-one"
        }],
        "collections": [{
            "id": "collection-one",
            "name": "Favorites",
            "createdAt": 12,
            "updatedAt": 13,
            "photoIds": ["photo-one"]
        }],
        "stacks": [{
            "id": "stack-one",
            "name": "Stack",
            "photoIds": ["photo-one"],
            "collapsed": true
        }]
    }))
    .unwrap()
}
