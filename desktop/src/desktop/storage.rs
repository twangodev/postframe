use super::*;

pub(super) fn begin_write(
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

pub(super) fn replace_file(temporary: &Path, target: &Path) -> Result<()> {
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

pub(super) fn discard_writes(writes: &mut HashMap<Uuid, PendingWrite>) {
    for (_, write) in writes.drain() {
        drop(write.file);
        let _ = fs::remove_file(write.temporary);
    }
}

pub(super) fn validate_kind(kind: &str) -> Result<()> {
    if LIBRARY_DIRECTORIES.contains(&kind) {
        Ok(())
    } else {
        Err(DesktopError::Invalid(format!("Unknown asset kind {kind}")))
    }
}

pub(super) fn validate_storage_name(name: &str) -> Result<()> {
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

pub(super) fn validate_hash(hash: Option<&str>) -> Result<()> {
    if hash.is_none_or(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Ok(())
    } else {
        Err(DesktopError::Invalid("Invalid SHA-256 digest".into()))
    }
}

pub(super) fn parse_token(token: &str) -> Result<Uuid> {
    Uuid::parse_str(token).map_err(|_| DesktopError::Invalid("Invalid write token".into()))
}

pub(super) fn available_library_path(parent: &Path) -> Result<PathBuf> {
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

pub(super) fn remembered_path(config_dir: &Path) -> Result<Option<PathBuf>> {
    let path = config_dir.join(CONFIG_FILE);
    match fs::read(path) {
        Ok(contents) => Ok(Some(
            serde_json::from_slice::<RememberedLibrary>(&contents)?.path,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn remember_path(config_dir: &Path, path: &Path) -> Result<()> {
    fs::create_dir_all(config_dir)?;
    atomic_write(
        &config_dir.join(CONFIG_FILE),
        &serde_json::to_vec_pretty(&RememberedLibrary {
            path: path.to_owned(),
        })?,
    )
}

pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
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

pub(super) fn directory_size(path: &Path) -> Result<u64> {
    let mut total = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && !entry.file_name().to_string_lossy().ends_with(".tmp") {
            total += entry.metadata()?.len();
        }
    }
    Ok(total)
}

pub(super) fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
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

pub(super) fn protocol_url(kind: &str, name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("http://postframe-asset.localhost/{kind}/{name}")
    } else {
        format!("postframe-asset://localhost/{kind}/{name}")
    }
}

pub(super) fn reveal_path(path: &Path) -> Result<()> {
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

pub(super) fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn command_error(error: DesktopError) -> String {
    error.to_string()
}
