use super::*;

impl Library {
    pub(super) fn create(parent: &Path) -> Result<Self> {
        let parent = parent.canonicalize()?;
        if !parent.is_dir() {
            return Err(DesktopError::Invalid(
                "Choose an existing parent folder".into(),
            ));
        }
        let root = available_library_path(&parent)?;
        fs::create_dir(&root)?;
        let result = (|| {
            for directory in LIBRARY_DIRECTORIES {
                fs::create_dir(root.join(directory))?;
            }
            let marker = LibraryMarker {
                format_version: FORMAT_VERSION,
                library_id: Uuid::new_v4(),
            };
            atomic_write(
                &root.join(MARKER_FILE),
                &serde_json::to_vec_pretty(&marker)?,
            )?;
            Self::open(&root)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&root);
        }
        result
    }

    pub(super) fn open(path: &Path) -> Result<Self> {
        let root = path.canonicalize()?;
        let marker: LibraryMarker = serde_json::from_slice(&fs::read(root.join(MARKER_FILE))?)?;
        if marker.format_version != FORMAT_VERSION {
            return Err(DesktopError::Invalid(format!(
                "This library uses unsupported format {}",
                marker.format_version
            )));
        }
        for directory in LIBRARY_DIRECTORIES {
            fs::create_dir_all(root.join(directory))?;
        }
        let connection = Connection::open(root.join(DATABASE_FILE))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        initialize_schema(&connection)?;
        Ok(Self { root, connection })
    }
}
