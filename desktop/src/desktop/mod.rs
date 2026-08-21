#![cfg_attr(not(feature = "shell"), allow(dead_code))]

use rusqlite::Connection;
use serde::Serialize;
use sha2::Sha256;
use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;
use std::sync::Mutex;
use thiserror::Error;
use uuid::Uuid;

const FORMAT_VERSION: u64 = 1;
const MARKER_FILE: &str = ".postframe-library.json";
const DATABASE_FILE: &str = "library.sqlite3";
const CONFIG_FILE: &str = "desktop-library.json";
const LIBRARY_DIRECTORIES: [AssetKind; 4] = [
    AssetKind::Originals,
    AssetKind::Thumbnails,
    AssetKind::Edits,
    AssetKind::Masks,
];

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

mod assets;
mod catalog;
mod library;
mod managed_library;
mod model;
mod storage;

use model::DesktopStatus;
use model::{AssetKind, AssetSource, DurableUsage, StoredAssetFile};
use storage::*;

#[cfg(feature = "shell")]
pub mod shell;

#[cfg(test)]
mod tests;
