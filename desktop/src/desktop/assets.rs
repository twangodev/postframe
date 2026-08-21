use super::{
    AssetKind, AssetSource, DesktopError, DesktopState, DurableUsage, Result, StoredAssetFile,
    begin_write, directory_size, parse_token, protocol_url, replace_file, validate_hash,
    validate_storage_name,
};
use sha2::Digest;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

impl DesktopState {
    pub(super) fn asset_source(
        &self,
        kind: AssetKind,
        storage_name: String,
    ) -> Result<AssetSource> {
        let path = self.asset_path(kind, &storage_name)?;
        Ok(AssetSource {
            url: protocol_url(kind, &storage_name),
            name: storage_name,
            size: path.metadata()?.len(),
        })
    }

    pub(super) fn asset_exists(&self, kind: AssetKind, storage_name: &str) -> Result<bool> {
        Ok(self.asset_path(kind, storage_name)?.is_file())
    }

    pub(super) fn begin_asset_write(
        &self,
        kind: AssetKind,
        storage_name: &str,
        expected_size: u64,
        expected_hash: Option<String>,
    ) -> Result<String> {
        let target = self.asset_path(kind, storage_name)?;
        self.begin_write(target, expected_size, expected_hash)
    }

    pub(super) fn begin_export_write(
        &self,
        target: PathBuf,
        expected_size: u64,
        expected_hash: Option<String>,
    ) -> Result<String> {
        let parent = target
            .parent()
            .ok_or_else(|| DesktopError::Invalid("Choose a valid export path".into()))?;
        if !parent.is_dir() {
            return Err(DesktopError::Invalid(
                "The export folder is unavailable".into(),
            ));
        }
        self.begin_write(target, expected_size, expected_hash)
    }

    pub(super) fn append_write(&self, token: &str, offset: u64, data: &[u8]) -> Result<()> {
        let token = parse_token(token)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        let write = inner
            .writes
            .get_mut(&token)
            .ok_or_else(|| DesktopError::Invalid("Unknown write token".into()))?;
        if write.written != offset {
            return Err(DesktopError::Invalid(format!(
                "Expected write offset {}, received {offset}",
                write.written
            )));
        }
        if write.written + data.len() as u64 > write.expected_size {
            return Err(DesktopError::Invalid(
                "Write exceeds its declared size".into(),
            ));
        }
        write.file.write_all(data)?;
        write.hasher.update(data);
        write.written += data.len() as u64;
        Ok(())
    }

    pub(super) fn commit_write(&self, token: &str) -> Result<()> {
        let token = parse_token(token)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        let mut write = inner
            .writes
            .remove(&token)
            .ok_or_else(|| DesktopError::Invalid("Unknown write token".into()))?;
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
        result
    }

    pub(super) fn abort_write(&self, token: &str) -> Result<()> {
        let token = parse_token(token)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        if let Some(write) = inner.writes.remove(&token) {
            drop(write.file);
            let _ = fs::remove_file(write.temporary);
        }
        Ok(())
    }

    pub(super) fn delete_assets(&self, kind: AssetKind, storage_names: &[String]) -> Result<()> {
        let root = self.library_root()?;
        for name in storage_names {
            validate_storage_name(name)?;
            match fs::remove_file(root.join(kind.directory()).join(name)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    pub(super) fn durable_usage(&self) -> Result<DurableUsage> {
        let root = self.library_root()?;
        Ok(DurableUsage {
            originals: directory_size(&root.join(AssetKind::Originals.directory()))?,
            thumbnails: directory_size(&root.join(AssetKind::Thumbnails.directory()))?,
            edits: directory_size(&root.join(AssetKind::Edits.directory()))?,
            masks: directory_size(&root.join(AssetKind::Masks.directory()))?,
        })
    }

    pub(super) fn list_assets(&self, kind: AssetKind) -> Result<Vec<StoredAssetFile>> {
        let directory = self.library_root()?.join(kind.directory());
        let mut files = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let storage_name = entry.file_name().to_string_lossy().into_owned();
            if storage_name.ends_with(".tmp") || storage_name.starts_with('.') {
                continue;
            }
            files.push(StoredAssetFile {
                storage_name,
                size: entry.metadata()?.len(),
            });
        }
        Ok(files)
    }

    pub(super) fn asset_path(&self, kind: AssetKind, storage_name: &str) -> Result<PathBuf> {
        validate_storage_name(storage_name)?;
        Ok(self
            .library_root()?
            .join(kind.directory())
            .join(storage_name))
    }

    fn begin_write(
        &self,
        target: PathBuf,
        expected_size: u64,
        expected_hash: Option<String>,
    ) -> Result<String> {
        validate_hash(expected_hash.as_deref())?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        begin_write(&mut inner.writes, target, expected_size, expected_hash)
            .map(|token| token.to_string())
    }

    fn library_root(&self) -> Result<PathBuf> {
        let inner = self.inner.lock().expect("desktop state poisoned");
        inner
            .library
            .as_ref()
            .map(|library| library.root.clone())
            .ok_or(DesktopError::NoLibrary)
    }
}
