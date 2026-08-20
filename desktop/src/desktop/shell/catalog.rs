use super::super::*;

#[tauri::command]
pub fn catalog_load_library(state: State<'_, DesktopState>) -> CommandResult<Option<Value>> {
    with_library(&state, |library| library.load_library()).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_library(library: Value, state: State<'_, DesktopState>) -> CommandResult<()> {
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
