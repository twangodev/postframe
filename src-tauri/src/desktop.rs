#![cfg_attr(not(feature = "shell"), allow(dead_code))]

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(feature = "shell")]
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(feature = "shell")]
use tauri::State;
use thiserror::Error;
use uuid::Uuid;

const FORMAT_VERSION: u64 = 1;
const MARKER_FILE: &str = ".postframe-library.json";
const DATABASE_FILE: &str = "library.sqlite3";
const CONFIG_FILE: &str = "desktop-library.json";
const LIBRARY_DIRECTORIES: [&str; 4] = ["originals", "thumbnails", "edits", "masks"];

#[cfg(feature = "shell")]
type CommandResult<T> = Result<T, String>;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("No Postframe library is open")]
    NoLibrary,
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

type Result<T> = std::result::Result<T, DesktopError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DesktopStatus {
    Ready { path: String },
    NeedsLibrary,
    Error { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSource {
    url: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResolution {
    additions: Vec<Value>,
    photo_ids: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelete {
    kind: String,
    storage_name: String,
    queued_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableUsage {
    originals: u64,
    thumbnails: u64,
    edits: u64,
    masks: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAssetFile {
    storage_name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReferences {
    originals: Vec<String>,
    thumbnails: Vec<String>,
    edits: Vec<String>,
    masks: Vec<String>,
    photo_ids: Vec<String>,
}

struct PendingWrite {
    target: PathBuf,
    temporary: PathBuf,
    file: File,
    expected_size: u64,
    expected_hash: Option<String>,
    hasher: Sha256,
    written: u64,
}

pub struct DesktopState {
    inner: Mutex<DesktopInner>,
    config_dir: PathBuf,
}

struct DesktopInner {
    library: Option<Library>,
    writes: HashMap<Uuid, PendingWrite>,
    startup_error: Option<String>,
}

struct Library {
    root: PathBuf,
    connection: Connection,
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryMarker {
    format_version: u64,
    library_id: Uuid,
}

#[derive(Serialize, serde::Deserialize)]
struct RememberedLibrary {
    path: PathBuf,
}

impl DesktopState {
    pub fn new(config_dir: PathBuf) -> Self {
        let (library, startup_error) = match remembered_path(&config_dir) {
            Ok(Some(path)) => match Library::open(&path) {
                Ok(library) => (Some(library), None),
                Err(error) => (None, Some(error.to_string())),
            },
            Ok(None) => (None, None),
            Err(error) => (None, Some(error.to_string())),
        };
        Self {
            inner: Mutex::new(DesktopInner {
                library,
                writes: HashMap::new(),
                startup_error,
            }),
            config_dir,
        }
    }

    fn switch(&self, library: Library) -> Result<String> {
        let path = library.root.clone();
        remember_path(&self.config_dir, &path)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        discard_writes(&mut inner.writes);
        inner.library = Some(library);
        inner.startup_error = None;
        Ok(display_path(&path))
    }
}

impl Library {
    fn create(parent: &Path) -> Result<Self> {
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

    fn open(path: &Path) -> Result<Self> {
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

    fn load_library(&self) -> Result<Option<Value>> {
        let library = self
            .connection
            .query_row(
                "SELECT created_at, updated_at FROM library WHERE id = 1",
                [],
                |row| Ok((row.get::<_, u64>(0)?, row.get::<_, u64>(1)?)),
            )
            .optional()?;
        let Some((created_at, updated_at)) = library else {
            return Ok(None);
        };
        let photos = json_rows(
            &self.connection,
            "SELECT payload FROM photos ORDER BY imported_at",
        )?;
        let mut collections = json_rows(
            &self.connection,
            "SELECT payload FROM collections ORDER BY created_at",
        )?;
        for collection in &mut collections {
            let id = required_string(collection, "id")?;
            collection["photoIds"] = Value::Array(member_ids(
                &self.connection,
                "SELECT photo_id FROM collection_photos WHERE collection_id = ?1 ORDER BY position",
                id,
            )?);
        }
        let mut stacks = json_rows(&self.connection, "SELECT payload FROM stacks ORDER BY id")?;
        for stack in &mut stacks {
            let id = required_string(stack, "id")?;
            stack["photoIds"] = Value::Array(member_ids(
                &self.connection,
                "SELECT photo_id FROM stack_photos WHERE stack_id = ?1 ORDER BY position",
                id,
            )?);
        }
        Ok(Some(json!({
            "version": 1,
            "createdAt": created_at,
            "updatedAt": updated_at,
            "photos": photos,
            "collections": collections,
            "stacks": stacks
        })))
    }

    fn save_library(&mut self, manifest: &Value) -> Result<()> {
        let created_at = required_u64(manifest, "createdAt")?;
        let updated_at = required_u64(manifest, "updatedAt")?;
        let photos = required_array(manifest, "photos")?;
        let collections = required_array(manifest, "collections")?;
        let stacks = required_array(manifest, "stacks")?;
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            "DELETE FROM collection_photos;
             DELETE FROM stack_photos;
             DELETE FROM assets;
             DELETE FROM photos;
             DELETE FROM collections;
             DELETE FROM stacks;",
        )?;
        transaction.execute(
            "INSERT INTO library (id, created_at, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, updated_at = excluded.updated_at",
            params![created_at, updated_at],
        )?;
        for photo in photos {
            insert_photo(&transaction, photo)?;
        }
        for collection in collections {
            upsert_collection(&transaction, collection)?;
        }
        replace_stacks(&transaction, stacks, &HashMap::new())?;
        transaction.commit()?;
        Ok(())
    }

    fn resolve_imports(&self, photos: &[Value]) -> Result<ImportResolution> {
        let mut resolved = HashMap::new();
        {
            let mut statement = self
                .connection
                .prepare("SELECT fingerprint, id FROM photos")?;
            for row in statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))? {
                let (fingerprint, id): (String, String) = row?;
                resolved.insert(fingerprint, id);
            }
        }
        let mut additions = Vec::new();
        let mut photo_ids = HashMap::new();
        for photo in photos {
            let id = required_string(photo, "id")?.to_owned();
            let fingerprint = photo_fingerprint(photo)?;
            if let Some(existing) = resolved.get(&fingerprint) {
                photo_ids.insert(id, existing.clone());
            } else {
                resolved.insert(fingerprint, id.clone());
                photo_ids.insert(id.clone(), id.clone());
                additions.push(photo.clone());
            }
        }
        Ok(ImportResolution {
            additions,
            photo_ids,
        })
    }

    fn add_photos(
        &mut self,
        library_created_at: u64,
        photos: &[Value],
        collection: Option<&Value>,
    ) -> Result<()> {
        let transaction = self.connection.transaction()?;
        let now = now_millis();
        transaction.execute(
            "INSERT INTO library (id, created_at, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
            params![library_created_at, now],
        )?;
        for photo in photos {
            insert_photo(&transaction, photo)?;
        }
        if let Some(collection) = collection {
            upsert_collection(&transaction, collection)?;
        }
        transaction.commit()?;
        Ok(())
    }
}

fn initialize_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL UNIQUE,
            imported_at INTEGER NOT NULL,
            captured_at TEXT,
            flagged INTEGER NOT NULL,
            rejected INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            stack_id TEXT,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            storage_name TEXT NOT NULL UNIQUE,
            content_hash TEXT NOT NULL,
            photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            frame_index INTEGER NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('raw', 'display')),
            payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS assets_photo ON assets(photo_id, frame_index);
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_photos (
            collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY(collection_id, photo_id)
        );
        CREATE TABLE IF NOT EXISTS stacks (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stack_photos (
            stack_id TEXT NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
            photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY(stack_id, photo_id)
        );
        CREATE TABLE IF NOT EXISTS presets (
            id TEXT PRIMARY KEY,
            normalized_name TEXT NOT NULL UNIQUE,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_deletes (
            kind TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            queued_at INTEGER NOT NULL,
            PRIMARY KEY(kind, storage_name)
        );
        PRAGMA user_version = 1;",
    )?;
    Ok(())
}

fn insert_photo(transaction: &Transaction<'_>, photo: &Value) -> Result<()> {
    let id = required_string(photo, "id")?;
    let imported_at = required_u64(photo, "importedAt")?;
    let captured_at = photo
        .get("metadata")
        .and_then(|metadata| metadata.get("capturedAt"))
        .and_then(Value::as_str);
    transaction.execute(
        "INSERT INTO photos
         (id, fingerprint, imported_at, captured_at, flagged, rejected, rating, stack_id, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            photo_fingerprint(photo)?,
            imported_at,
            captured_at,
            required_bool(photo, "flagged")?,
            required_bool(photo, "rejected")?,
            required_u64(photo, "rating")?,
            photo.get("stackId").and_then(Value::as_str),
            serde_json::to_string(photo)?
        ],
    )?;
    for (frame_index, frame) in required_array(photo, "frames")?.iter().enumerate() {
        for role in ["raw", "display"] {
            let Some(asset) = frame.get(role).filter(|value| !value.is_null()) else {
                continue;
            };
            transaction.execute(
                "INSERT INTO assets
                 (id, storage_name, content_hash, photo_id, frame_index, role, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    required_string(asset, "id")?,
                    required_string(asset, "storageName")?,
                    required_string(asset, "contentHash")?,
                    id,
                    frame_index,
                    role,
                    serde_json::to_string(asset)?
                ],
            )?;
        }
    }
    Ok(())
}

fn upsert_collection(transaction: &Transaction<'_>, collection: &Value) -> Result<()> {
    let id = required_string(collection, "id")?;
    let name = required_string(collection, "name")?;
    let normalized_name = collection
        .get("normalizedName")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| normalize_name(name));
    let mut payload = collection.clone();
    if let Some(payload) = payload.as_object_mut() {
        payload.remove("normalizedName");
    }
    transaction.execute(
        "INSERT INTO collections (id, normalized_name, created_at, updated_at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           normalized_name = excluded.normalized_name,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           payload = excluded.payload",
        params![
            id,
            normalized_name,
            required_u64(collection, "createdAt")?,
            required_u64(collection, "updatedAt")?,
            serde_json::to_string(&payload)?
        ],
    )?;
    transaction.execute(
        "DELETE FROM collection_photos WHERE collection_id = ?1",
        [id],
    )?;
    for (position, photo_id) in required_array(collection, "photoIds")?.iter().enumerate() {
        transaction.execute(
            "INSERT INTO collection_photos (collection_id, photo_id, position) VALUES (?1, ?2, ?3)",
            params![id, string_value(photo_id, "collection photo ID")?, position],
        )?;
    }
    Ok(())
}

fn replace_stacks(
    transaction: &Transaction<'_>,
    stacks: &[Value],
    changed_photos: &HashMap<String, Option<String>>,
) -> Result<()> {
    transaction.execute("DELETE FROM stack_photos", [])?;
    transaction.execute("DELETE FROM stacks", [])?;
    for stack in stacks {
        let id = required_string(stack, "id")?;
        transaction.execute(
            "INSERT INTO stacks (id, payload) VALUES (?1, ?2)",
            params![id, serde_json::to_string(stack)?],
        )?;
        for (position, photo_id) in required_array(stack, "photoIds")?.iter().enumerate() {
            transaction.execute(
                "INSERT INTO stack_photos (stack_id, photo_id, position) VALUES (?1, ?2, ?3)",
                params![id, string_value(photo_id, "stack photo ID")?, position],
            )?;
        }
    }
    for (photo_id, stack_id) in changed_photos {
        let payload: String = transaction
            .query_row(
                "SELECT payload FROM photos WHERE id = ?1",
                [photo_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| DesktopError::Invalid(format!("Photo {photo_id} is missing")))?;
        let mut photo: Value = serde_json::from_str(&payload)?;
        photo["stackId"] = stack_id.clone().map(Value::String).unwrap_or(Value::Null);
        transaction.execute(
            "UPDATE photos SET stack_id = ?2, payload = ?3 WHERE id = ?1",
            params![photo_id, stack_id, serde_json::to_string(&photo)?],
        )?;
    }
    touch_library(transaction)?;
    Ok(())
}

#[cfg(feature = "shell")]
pub mod shell {
    use super::*;

    #[tauri::command]
    pub fn desktop_status(state: State<'_, DesktopState>) -> DesktopStatus {
        let inner = state.inner.lock().expect("desktop state poisoned");
        if let Some(library) = &inner.library {
            DesktopStatus::Ready {
                path: display_path(&library.root),
            }
        } else if let Some(message) = &inner.startup_error {
            DesktopStatus::Error {
                message: message.clone(),
            }
        } else {
            DesktopStatus::NeedsLibrary
        }
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn create_library(
        parent_path: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<String> {
        Library::create(Path::new(&parent_path))
            .and_then(|library| state.switch(library))
            .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn open_library(path: String, state: State<'_, DesktopState>) -> CommandResult<String> {
        Library::open(Path::new(&path))
            .and_then(|library| state.switch(library))
            .map_err(command_error)
    }

    #[tauri::command]
    pub fn close_library(state: State<'_, DesktopState>) -> CommandResult<()> {
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        discard_writes(&mut inner.writes);
        inner.library = None;
        Ok(())
    }

    #[tauri::command]
    pub fn reveal_library(state: State<'_, DesktopState>) -> CommandResult<()> {
        let inner = state.inner.lock().expect("desktop state poisoned");
        let path = &inner
            .library
            .as_ref()
            .ok_or(DesktopError::NoLibrary)
            .map_err(command_error)?
            .root;
        reveal_path(path).map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn asset_source(
        kind: String,
        storage_name: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<AssetSource> {
        validate_kind(&kind).map_err(command_error)?;
        validate_storage_name(&storage_name).map_err(command_error)?;
        let inner = state.inner.lock().expect("desktop state poisoned");
        let library = inner
            .library
            .as_ref()
            .ok_or_else(|| command_error(DesktopError::NoLibrary))?;
        let path = library.root.join(&kind).join(&storage_name);
        let size = path
            .metadata()
            .map_err(DesktopError::from)
            .map_err(command_error)?
            .len();
        Ok(AssetSource {
            url: protocol_url(&kind, &storage_name),
            name: storage_name,
            size,
        })
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn asset_exists(
        kind: String,
        storage_name: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<bool> {
        validate_kind(&kind).map_err(command_error)?;
        validate_storage_name(&storage_name).map_err(command_error)?;
        let inner = state.inner.lock().expect("desktop state poisoned");
        let library = inner
            .library
            .as_ref()
            .ok_or_else(|| command_error(DesktopError::NoLibrary))?;
        Ok(library.root.join(kind).join(storage_name).is_file())
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn begin_asset_write(
        kind: String,
        storage_name: String,
        expected_size: u64,
        expected_hash: Option<String>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<String> {
        validate_kind(&kind).map_err(command_error)?;
        validate_storage_name(&storage_name).map_err(command_error)?;
        validate_hash(expected_hash.as_deref()).map_err(command_error)?;
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        let root = inner
            .library
            .as_ref()
            .ok_or(DesktopError::NoLibrary)
            .map_err(command_error)?
            .root
            .clone();
        begin_write(
            &mut inner.writes,
            root.join(kind).join(storage_name),
            expected_size,
            expected_hash,
        )
        .map(|token| token.to_string())
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn begin_export_write(
        path: String,
        expected_size: u64,
        expected_hash: Option<String>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<String> {
        validate_hash(expected_hash.as_deref()).map_err(command_error)?;
        let target = PathBuf::from(path);
        let parent = target.parent().ok_or_else(|| {
            command_error(DesktopError::Invalid("Choose a valid export path".into()))
        })?;
        if !parent.is_dir() {
            return Err(command_error(DesktopError::Invalid(
                "The export folder is unavailable".into(),
            )));
        }
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        begin_write(&mut inner.writes, target, expected_size, expected_hash)
            .map(|token| token.to_string())
            .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn append_asset_write(
        token: String,
        offset: u64,
        data: Vec<u8>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        let token = parse_token(&token).map_err(command_error)?;
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        let write = inner
            .writes
            .get_mut(&token)
            .ok_or_else(|| command_error(DesktopError::Invalid("Unknown write token".into())))?;
        if write.written != offset {
            return Err(command_error(DesktopError::Invalid(format!(
                "Expected write offset {}, received {offset}",
                write.written
            ))));
        }
        if write.written + data.len() as u64 > write.expected_size {
            return Err(command_error(DesktopError::Invalid(
                "Write exceeds its declared size".into(),
            )));
        }
        write
            .file
            .write_all(&data)
            .map_err(DesktopError::from)
            .map_err(command_error)?;
        write.hasher.update(&data);
        write.written += data.len() as u64;
        Ok(())
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn commit_asset_write(token: String, state: State<'_, DesktopState>) -> CommandResult<()> {
        let token = parse_token(&token).map_err(command_error)?;
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        let mut write = inner
            .writes
            .remove(&token)
            .ok_or_else(|| command_error(DesktopError::Invalid("Unknown write token".into())))?;
        let result = (|| {
            if write.written != write.expected_size {
                return Err(DesktopError::Invalid(format!(
                    "Expected {} bytes, received {}",
                    write.expected_size, write.written
                )));
            }
            let actual_hash = format!("{:x}", write.hasher.finalize());
            if write
                .expected_hash
                .as_deref()
                .is_some_and(|expected| expected != actual_hash)
            {
                return Err(DesktopError::Invalid(
                    "Written asset failed checksum validation".into(),
                ));
            }
            write.file.flush()?;
            write.file.sync_all()?;
            drop(write.file);
            replace_file(&write.temporary, &write.target)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&write.temporary);
        }
        result.map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn abort_asset_write(token: String, state: State<'_, DesktopState>) -> CommandResult<()> {
        let token = parse_token(&token).map_err(command_error)?;
        let mut inner = state.inner.lock().expect("desktop state poisoned");
        if let Some(write) = inner.writes.remove(&token) {
            drop(write.file);
            let _ = fs::remove_file(write.temporary);
        }
        Ok(())
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn delete_assets(
        kind: String,
        storage_names: Vec<String>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        validate_kind(&kind).map_err(command_error)?;
        let inner = state.inner.lock().expect("desktop state poisoned");
        let root = inner
            .library
            .as_ref()
            .ok_or(DesktopError::NoLibrary)
            .map_err(command_error)?
            .root
            .clone();
        for name in storage_names {
            validate_storage_name(&name).map_err(command_error)?;
            match fs::remove_file(root.join(&kind).join(name)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(command_error(error.into())),
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub fn durable_usage(state: State<'_, DesktopState>) -> CommandResult<DurableUsage> {
        let inner = state.inner.lock().expect("desktop state poisoned");
        let root = &inner
            .library
            .as_ref()
            .ok_or(DesktopError::NoLibrary)
            .map_err(command_error)?
            .root;
        Ok(DurableUsage {
            originals: directory_size(&root.join("originals")).map_err(command_error)?,
            thumbnails: directory_size(&root.join("thumbnails")).map_err(command_error)?,
            edits: directory_size(&root.join("edits")).map_err(command_error)?,
            masks: directory_size(&root.join("masks")).map_err(command_error)?,
        })
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn list_assets(
        kind: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<Vec<StoredAssetFile>> {
        validate_kind(&kind).map_err(command_error)?;
        let inner = state.inner.lock().expect("desktop state poisoned");
        let directory = inner
            .library
            .as_ref()
            .ok_or(DesktopError::NoLibrary)
            .map_err(command_error)?
            .root
            .join(kind);
        let mut files = Vec::new();
        for entry in fs::read_dir(directory)
            .map_err(DesktopError::from)
            .map_err(command_error)?
        {
            let entry = entry.map_err(DesktopError::from).map_err(command_error)?;
            if !entry
                .file_type()
                .map_err(DesktopError::from)
                .map_err(command_error)?
                .is_file()
            {
                continue;
            }
            let storage_name = entry.file_name().to_string_lossy().into_owned();
            if storage_name.ends_with(".tmp") || storage_name.starts_with('.') {
                continue;
            }
            files.push(StoredAssetFile {
                storage_name,
                size: entry
                    .metadata()
                    .map_err(DesktopError::from)
                    .map_err(command_error)?
                    .len(),
            });
        }
        Ok(files)
    }

    #[tauri::command]
    pub fn catalog_load_library(state: State<'_, DesktopState>) -> CommandResult<Option<Value>> {
        with_library(&state, |library| library.load_library()).map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_save_library(
        library: Value,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |active| active.save_library(&library)).map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_resolve_imports(
        photos: Vec<Value>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<ImportResolution> {
        with_library(&state, |library| library.resolve_imports(&photos)).map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_add_photos(
        library_created_at: u64,
        photos: Vec<Value>,
        collection: Option<Value>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |library| {
            library.add_photos(library_created_at, &photos, collection.as_ref())
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_update_photo(photo: Value, state: State<'_, DesktopState>) -> CommandResult<()> {
        with_library_mut(&state, |library| {
        let transaction = library.connection.transaction()?;
        let id = required_string(&photo, "id")?;
        let updated = transaction.execute(
            "UPDATE photos SET flagged = ?2, rejected = ?3, rating = ?4, stack_id = ?5, payload = ?6 WHERE id = ?1",
            params![
                id,
                required_bool(&photo, "flagged")?,
                required_bool(&photo, "rejected")?,
                required_u64(&photo, "rating")?,
                photo.get("stackId").and_then(Value::as_str),
                serde_json::to_string(&photo)?
            ],
        )?;
        if updated == 0 {
            return Err(DesktopError::Invalid(format!("Photo {id} is missing")));
        }
        touch_library(&transaction)?;
        transaction.commit()?;
        Ok(())
    })
    .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_save_collection(
        collection: Value,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |library| {
            let transaction = library.connection.transaction()?;
            upsert_collection(&transaction, &collection)?;
            touch_library(&transaction)?;
            transaction.commit()?;
            Ok(())
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_delete_collection(
        collection_id: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |library| {
            let transaction = library.connection.transaction()?;
            transaction.execute("DELETE FROM collections WHERE id = ?1", [&collection_id])?;
            touch_library(&transaction)?;
            transaction.commit()?;
            Ok(())
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_save_stacks(
        stacks: Vec<Value>,
        changed_photos: HashMap<String, Option<String>>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |library| {
            let transaction = library.connection.transaction()?;
            replace_stacks(&transaction, &stacks, &changed_photos)?;
            transaction.commit()?;
            Ok(())
        })
        .map_err(command_error)
    }

    #[tauri::command]
    pub fn catalog_list_presets(state: State<'_, DesktopState>) -> CommandResult<Vec<Value>> {
        with_library(&state, |library| {
            json_rows(
                &library.connection,
                "SELECT payload FROM presets ORDER BY updated_at DESC",
            )
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_save_preset(preset: Value, state: State<'_, DesktopState>) -> CommandResult<()> {
        with_library(&state, |library| {
        let id = required_string(&preset, "id")?;
        let normalized_name = required_string(&preset, "normalizedName")?;
        let updated_at = required_string(&preset, "updatedAt")?;
        library.connection.execute(
            "INSERT INTO presets (id, normalized_name, updated_at, payload) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET normalized_name = excluded.normalized_name, updated_at = excluded.updated_at, payload = excluded.payload",
            params![id, normalized_name, updated_at, serde_json::to_string(&preset)?],
        )?;
        Ok(())
    })
    .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_delete_preset(
        preset_id: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library(&state, |library| {
            library
                .connection
                .execute("DELETE FROM presets WHERE id = ?1", [&preset_id])?;
            Ok(())
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_delete_photo(
        photo_id: String,
        render_cache_name: String,
        state: State<'_, DesktopState>,
    ) -> CommandResult<Vec<PendingDelete>> {
        with_library_mut(&state, |library| {
            let transaction = library.connection.transaction()?;
            let photo: Option<String> = transaction
                .query_row(
                    "SELECT payload FROM photos WHERE id = ?1",
                    [&photo_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(photo) = photo else {
                return Ok(Vec::new());
            };
            let photo: Value = serde_json::from_str(&photo)?;
            let mut pending = Vec::new();
            let queued_at = now_millis();
            for frame in required_array(&photo, "frames")? {
                for role in ["raw", "display"] {
                    if let Some(asset) = frame.get(role).filter(|value| !value.is_null()) {
                        pending.push(PendingDelete {
                            kind: "original".into(),
                            storage_name: required_string(asset, "storageName")?.into(),
                            queued_at,
                        });
                    }
                }
            }
            if let Some(name) = photo.get("thumbnailStorageName").and_then(Value::as_str) {
                pending.push(PendingDelete {
                    kind: "thumbnail".into(),
                    storage_name: name.into(),
                    queued_at,
                });
            }
            pending.push(PendingDelete {
                kind: "edit".into(),
                storage_name: format!("{photo_id}.json"),
                queued_at,
            });
            pending.push(PendingDelete {
                kind: "derived".into(),
                storage_name: render_cache_name,
                queued_at,
            });
            for deletion in &pending {
                transaction.execute(
                "INSERT INTO pending_deletes (kind, storage_name, queued_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(kind, storage_name) DO UPDATE SET queued_at = excluded.queued_at",
                params![deletion.kind, deletion.storage_name, deletion.queued_at],
            )?;
            }
            transaction.execute("DELETE FROM photos WHERE id = ?1", [&photo_id])?;
            touch_library(&transaction)?;
            transaction.commit()?;
            Ok(pending)
        })
        .map_err(command_error)
    }

    #[tauri::command]
    pub fn catalog_pending_deletions(
        state: State<'_, DesktopState>,
    ) -> CommandResult<Vec<PendingDelete>> {
        with_library(&state, |library| {
            let mut statement = library.connection.prepare(
                "SELECT kind, storage_name, queued_at FROM pending_deletes ORDER BY queued_at",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(PendingDelete {
                    kind: row.get(0)?,
                    storage_name: row.get(1)?,
                    queued_at: row.get(2)?,
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(DesktopError::from)
        })
        .map_err(command_error)
    }

    #[tauri::command(rename_all = "camelCase")]
    pub fn catalog_complete_deletions(
        deletions: Vec<PendingDelete>,
        state: State<'_, DesktopState>,
    ) -> CommandResult<()> {
        with_library_mut(&state, |library| {
            let transaction = library.connection.transaction()?;
            for deletion in deletions {
                transaction.execute(
                    "DELETE FROM pending_deletes WHERE kind = ?1 AND storage_name = ?2",
                    params![deletion.kind, deletion.storage_name],
                )?;
            }
            transaction.commit()?;
            Ok(())
        })
        .map_err(command_error)
    }

    #[tauri::command]
    pub fn catalog_storage_references(
        state: State<'_, DesktopState>,
    ) -> CommandResult<StorageReferences> {
        with_library(&state, |library| {
            let originals = string_rows(&library.connection, "SELECT storage_name FROM assets")?;
            let photo_ids = string_rows(&library.connection, "SELECT id FROM photos")?;
            let thumbnails = json_rows(&library.connection, "SELECT payload FROM photos")?
                .into_iter()
                .filter_map(|photo| {
                    photo
                        .get("thumbnailStorageName")?
                        .as_str()
                        .map(str::to_owned)
                })
                .collect();
            let edits = photo_ids
                .iter()
                .map(|id| format!("{id}.json"))
                .collect::<Vec<_>>();
            let mut masks = HashSet::new();
            for edit in &edits {
                let path = library.root.join("edits").join(edit);
                let Ok(contents) = fs::read(&path) else {
                    continue;
                };
                let Ok(value) = serde_json::from_slice::<Value>(&contents) else {
                    continue;
                };
                collect_mask_names(&value, &mut masks);
            }
            Ok(StorageReferences {
                originals,
                thumbnails,
                edits,
                masks: masks.into_iter().collect(),
                photo_ids,
            })
        })
        .map_err(command_error)
    }

    pub fn protocol_response(
        request: &tauri::http::Request<Vec<u8>>,
        state: &DesktopState,
    ) -> tauri::http::Response<Vec<u8>> {
        match read_protocol_asset(request, state) {
            Ok(response) => response,
            Err(error) => tauri::http::Response::builder()
                .status(404)
                .header("Cross-Origin-Resource-Policy", "cross-origin")
                .body(error.to_string().into_bytes())
                .expect("valid protocol response"),
        }
    }

    fn read_protocol_asset(
        request: &tauri::http::Request<Vec<u8>>,
        state: &DesktopState,
    ) -> Result<tauri::http::Response<Vec<u8>>> {
        let segments = request
            .uri()
            .path()
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        if segments.len() != 2 {
            return Err(DesktopError::Invalid("Invalid asset URL".into()));
        }
        validate_kind(segments[0])?;
        validate_storage_name(segments[1])?;
        let path = {
            let inner = state.inner.lock().expect("desktop state poisoned");
            inner
                .library
                .as_ref()
                .ok_or(DesktopError::NoLibrary)?
                .root
                .join(segments[0])
                .join(segments[1])
        };
        let mut file = File::open(&path)?;
        let size = file.metadata()?.len();
        let range = request
            .headers()
            .get("range")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| parse_range(value, size));
        let (start, end, status) =
            range
                .map(|(start, end)| (start, end, 206))
                .unwrap_or((0, size.saturating_sub(1), 200));
        let length = if size == 0 { 0 } else { end - start + 1 };
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = vec![0; length as usize];
        file.read_exact(&mut bytes)?;
        let mut response = tauri::http::Response::builder()
            .status(status)
            .header(
                "Content-Type",
                mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .as_ref(),
            )
            .header("Content-Length", length)
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cross-Origin-Resource-Policy", "cross-origin");
        if status == 206 {
            response = response.header("Content-Range", format!("bytes {start}-{end}/{size}"));
        }
        response
            .body(bytes)
            .map_err(|error| DesktopError::Invalid(error.to_string()))
    }
}

fn begin_write(
    writes: &mut HashMap<Uuid, PendingWrite>,
    target: PathBuf,
    expected_size: u64,
    expected_hash: Option<String>,
) -> Result<Uuid> {
    let parent = target
        .parent()
        .ok_or_else(|| DesktopError::Invalid("Write target has no parent".into()))?;
    fs::create_dir_all(parent)?;
    let token = Uuid::new_v4();
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| DesktopError::Invalid("Write target has no file name".into()))?;
    let temporary = parent.join(format!(".{file_name}.{token}.tmp"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    writes.insert(
        token,
        PendingWrite {
            target,
            temporary,
            file,
            expected_size,
            expected_hash,
            hasher: Sha256::new(),
            written: 0,
        },
    );
    Ok(token)
}

fn replace_file(temporary: &Path, target: &Path) -> Result<()> {
    match fs::rename(temporary, target) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
            ) && target.exists() =>
        {
            fs::remove_file(target)?;
            fs::rename(temporary, target)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn discard_writes(writes: &mut HashMap<Uuid, PendingWrite>) {
    for (_, write) in writes.drain() {
        drop(write.file);
        let _ = fs::remove_file(write.temporary);
    }
}

fn with_library<T>(
    state: &DesktopState,
    operation: impl FnOnce(&Library) -> Result<T>,
) -> Result<T> {
    let inner = state.inner.lock().expect("desktop state poisoned");
    operation(inner.library.as_ref().ok_or(DesktopError::NoLibrary)?)
}

fn with_library_mut<T>(
    state: &DesktopState,
    operation: impl FnOnce(&mut Library) -> Result<T>,
) -> Result<T> {
    let mut inner = state.inner.lock().expect("desktop state poisoned");
    operation(inner.library.as_mut().ok_or(DesktopError::NoLibrary)?)
}

fn touch_library(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute(
        "UPDATE library SET updated_at = ?1 WHERE id = 1",
        [now_millis()],
    )?;
    Ok(())
}

fn json_rows(connection: &Connection, query: &str) -> Result<Vec<Value>> {
    let mut statement = connection.prepare(query)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

fn string_rows(connection: &Connection, query: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(query)?;
    statement
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(DesktopError::from)
}

fn member_ids(connection: &Connection, query: &str, id: &str) -> Result<Vec<Value>> {
    let mut statement = connection.prepare(query)?;
    let ids = statement
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(ids.into_iter().map(Value::String).collect())
}

fn required_array<'a>(value: &'a Value, field: &str) -> Result<&'a [Value]> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be an array")))
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a string")))
}

fn string_value<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    value
        .as_str()
        .ok_or_else(|| DesktopError::Invalid(format!("{label} must be a string")))
}

fn required_u64(value: &Value, field: &str) -> Result<u64> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a positive integer")))
}

fn required_bool(value: &Value, field: &str) -> Result<bool> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a boolean")))
}

fn photo_fingerprint(photo: &Value) -> Result<String> {
    let mut parts = vec![required_string(photo, "kind")?.to_owned()];
    for frame in required_array(photo, "frames")? {
        let raw = frame
            .get("raw")
            .and_then(|asset| asset.get("contentHash"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let display = frame
            .get("display")
            .and_then(|asset| asset.get("contentHash"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let hint = frame
            .get("filenameExposureHint")
            .filter(|value| !value.is_null())
            .map(Value::to_string)
            .unwrap_or_default();
        parts.push(format!("{raw}:{display}:{hint}"));
    }
    Ok(parts.join("|"))
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn validate_kind(kind: &str) -> Result<()> {
    if LIBRARY_DIRECTORIES.contains(&kind) {
        Ok(())
    } else {
        Err(DesktopError::Invalid(format!("Unknown asset kind {kind}")))
    }
}

fn validate_storage_name(name: &str) -> Result<()> {
    let valid = !name.is_empty()
        && name.len() <= 255
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
        })
        && name.contains('.')
        && !name.starts_with('.')
        && !name.ends_with('.');
    if valid {
        Ok(())
    } else {
        Err(DesktopError::Invalid("Invalid asset storage name".into()))
    }
}

fn validate_hash(hash: Option<&str>) -> Result<()> {
    if hash.is_none_or(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Ok(())
    } else {
        Err(DesktopError::Invalid("Invalid SHA-256 digest".into()))
    }
}

fn parse_token(token: &str) -> Result<Uuid> {
    Uuid::parse_str(token).map_err(|_| DesktopError::Invalid("Invalid write token".into()))
}

fn available_library_path(parent: &Path) -> Result<PathBuf> {
    for suffix in 1..=999 {
        let name = if suffix == 1 {
            "Postframe Library".to_owned()
        } else {
            format!("Postframe Library {suffix}")
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(DesktopError::Invalid(
        "Unable to choose a new library folder name".into(),
    ))
}

fn remembered_path(config_dir: &Path) -> Result<Option<PathBuf>> {
    let path = config_dir.join(CONFIG_FILE);
    match fs::read(path) {
        Ok(contents) => Ok(Some(
            serde_json::from_slice::<RememberedLibrary>(&contents)?.path,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn remember_path(config_dir: &Path, path: &Path) -> Result<()> {
    fs::create_dir_all(config_dir)?;
    atomic_write(
        &config_dir.join(CONFIG_FILE),
        &serde_json::to_vec_pretty(&RememberedLibrary {
            path: path.to_owned(),
        })?,
    )
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| DesktopError::Invalid("File has no parent".into()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("postframe"),
        Uuid::new_v4()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    replace_file(&temporary, path)
}

fn directory_size(path: &Path) -> Result<u64> {
    let mut total = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && !entry.file_name().to_string_lossy().ends_with(".tmp") {
            total += entry.metadata()?.len();
        }
    }
    Ok(total)
}

fn collect_mask_names(value: &Value, names: &mut HashSet<String>) {
    match value {
        Value::Object(object) => {
            if let Some(name) = object.get("storageName").and_then(Value::as_str)
                && name.ends_with(".mask")
            {
                names.insert(name.to_owned());
            }
            for child in object.values() {
                collect_mask_names(child, names);
            }
        }
        Value::Array(array) => {
            for child in array {
                collect_mask_names(child, names);
            }
        }
        _ => {}
    }
}

fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    let range = header.strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        size.checked_sub(1)?
    } else {
        end.parse::<u64>().ok()?.min(size.checked_sub(1)?)
    };
    (start <= end && end < size).then_some((start, end))
}

fn protocol_url(kind: &str, name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("http://postframe-asset.localhost/{kind}/{name}")
    } else {
        format!("postframe-asset://localhost/{kind}/{name}")
    }
}

fn reveal_path(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status()?;
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status()?;
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("xdg-open").arg(path).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(DesktopError::Invalid(
            "The system file manager could not reveal this library".into(),
        ))
    }
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as u64
}

fn command_error(error: DesktopError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
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
}
