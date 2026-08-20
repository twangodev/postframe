use super::*;

impl Library {
    pub(super) fn load_library(&self) -> Result<Option<Value>> {
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

    pub(super) fn save_library(&mut self, manifest: &Value) -> Result<()> {
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

    pub(super) fn resolve_imports(&self, photos: &[Value]) -> Result<ImportResolution> {
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

    pub(super) fn add_photos(
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

pub(super) fn initialize_schema(connection: &Connection) -> Result<()> {
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

pub(super) fn insert_photo(transaction: &Transaction<'_>, photo: &Value) -> Result<()> {
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

pub(super) fn upsert_collection(transaction: &Transaction<'_>, collection: &Value) -> Result<()> {
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

pub(super) fn replace_stacks(
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

pub(super) fn touch_library(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute(
        "UPDATE library SET updated_at = ?1 WHERE id = 1",
        [now_millis()],
    )?;
    Ok(())
}

pub(super) fn json_rows(connection: &Connection, query: &str) -> Result<Vec<Value>> {
    let mut statement = connection.prepare(query)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

pub(super) fn string_rows(connection: &Connection, query: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(query)?;
    statement
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(DesktopError::from)
}

pub(super) fn member_ids(connection: &Connection, query: &str, id: &str) -> Result<Vec<Value>> {
    let mut statement = connection.prepare(query)?;
    let ids = statement
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(ids.into_iter().map(Value::String).collect())
}

pub(super) fn required_array<'a>(value: &'a Value, field: &str) -> Result<&'a [Value]> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be an array")))
}

pub(super) fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a string")))
}

pub(super) fn string_value<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    value
        .as_str()
        .ok_or_else(|| DesktopError::Invalid(format!("{label} must be a string")))
}

pub(super) fn required_u64(value: &Value, field: &str) -> Result<u64> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a positive integer")))
}

pub(super) fn required_bool(value: &Value, field: &str) -> Result<bool> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| DesktopError::Invalid(format!("{field} must be a boolean")))
}

pub(super) fn photo_fingerprint(photo: &Value) -> Result<String> {
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

pub(super) fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

pub(super) fn collect_mask_names(value: &Value, names: &mut HashSet<String>) {
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

pub(super) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as u64
}
