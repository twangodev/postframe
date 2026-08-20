#![cfg_attr(not(feature = "shell"), allow(dead_code))]

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
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
type CommandResult<T> = std::result::Result<T, String>;

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

#[derive(Deserialize, Serialize, Clone)]
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

mod catalog;
mod library;
mod storage;

use catalog::*;
use storage::*;

#[cfg(feature = "shell")]
pub mod shell;

#[cfg(test)]
mod tests;
