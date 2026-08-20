use super::super::*;

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
    let parent = target
        .parent()
        .ok_or_else(|| command_error(DesktopError::Invalid("Choose a valid export path".into())))?;
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
