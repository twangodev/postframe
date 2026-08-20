use super::*;

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
    let loaded = library.load_library().unwrap().unwrap();
    assert_eq!(loaded["photos"], manifest["photos"]);
    assert_eq!(loaded["collections"], manifest["collections"]);
    assert_eq!(loaded["stacks"], manifest["stacks"]);
}

#[test]
fn resolves_duplicate_imports_by_content_identity() {
    let parent = tempfile::tempdir().unwrap();
    let mut library = Library::create(parent.path()).unwrap();
    let manifest = sample_manifest();
    library.save_library(&manifest).unwrap();
    let mut duplicate = manifest["photos"][0].clone();
    duplicate["id"] = Value::String("photo-copy".into());
    duplicate["frames"][0]["display"]["id"] = Value::String("asset-copy".into());
    duplicate["frames"][0]["display"]["storageName"] = Value::String("asset-copy.jpg".into());
    let resolution = library.resolve_imports(&[duplicate]).unwrap();
    assert!(resolution.additions.is_empty());
    assert_eq!(resolution.photo_ids["photo-copy"], "photo-one");
}

fn sample_manifest() -> Value {
    json!({
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
    })
}
