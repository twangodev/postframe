use super::super::model::{Collection, Photo, Stack};
use super::super::{DesktopError, Library, Result};
use super::{normalize_name, touch_library};
use rusqlite::{OptionalExtension, Transaction, params};
use std::collections::HashMap;

impl Library {
    pub(in crate::desktop) fn save_collection(&mut self, collection: &Collection) -> Result<()> {
        let transaction = self.connection.transaction()?;
        upsert_collection(&transaction, collection)?;
        touch_library(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    pub(in crate::desktop) fn delete_collection(&mut self, collection_id: &str) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM collections WHERE id = ?1", [collection_id])?;
        touch_library(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    pub(in crate::desktop) fn save_stacks(
        &mut self,
        stacks: &[Stack],
        changed_photos: &HashMap<String, Option<String>>,
    ) -> Result<()> {
        let transaction = self.connection.transaction()?;
        replace_stacks(&transaction, stacks, changed_photos)?;
        transaction.commit()?;
        Ok(())
    }
}

pub(super) fn upsert_collection(
    transaction: &Transaction<'_>,
    collection: &Collection,
) -> Result<()> {
    let normalized_name = collection
        .normalized_name
        .clone()
        .unwrap_or_else(|| normalize_name(&collection.name));
    let mut payload = collection.clone();
    payload.normalized_name = None;
    transaction.execute(
        "INSERT INTO collections (id, normalized_name, created_at, updated_at, payload)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           normalized_name = excluded.normalized_name,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           payload = excluded.payload",
        params![
            collection.id,
            normalized_name,
            collection.created_at,
            collection.updated_at,
            serde_json::to_string(&payload)?
        ],
    )?;
    transaction.execute(
        "DELETE FROM collection_photos WHERE collection_id = ?1",
        [&collection.id],
    )?;
    for (position, photo_id) in collection.photo_ids.iter().enumerate() {
        transaction.execute(
            "INSERT INTO collection_photos (collection_id, photo_id, position) VALUES (?1, ?2, ?3)",
            params![collection.id, photo_id, position],
        )?;
    }
    Ok(())
}

pub(super) fn replace_stacks(
    transaction: &Transaction<'_>,
    stacks: &[Stack],
    changed_photos: &HashMap<String, Option<String>>,
) -> Result<()> {
    transaction.execute("DELETE FROM stack_photos", [])?;
    transaction.execute("DELETE FROM stacks", [])?;
    for stack in stacks {
        transaction.execute(
            "INSERT INTO stacks (id, payload) VALUES (?1, ?2)",
            params![stack.id, serde_json::to_string(stack)?],
        )?;
        for (position, photo_id) in stack.photo_ids.iter().enumerate() {
            transaction.execute(
                "INSERT INTO stack_photos (stack_id, photo_id, position) VALUES (?1, ?2, ?3)",
                params![stack.id, photo_id, position],
            )?;
        }
    }
    for (photo_id, stack_id) in changed_photos {
        let payload = transaction
            .query_row(
                "SELECT payload FROM photos WHERE id = ?1",
                [photo_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| DesktopError::Invalid(format!("Photo {photo_id} is missing")))?;
        let mut photo = serde_json::from_str::<Photo>(&payload)?;
        photo.stack_id.clone_from(stack_id);
        transaction.execute(
            "UPDATE photos SET stack_id = ?2, payload = ?3 WHERE id = ?1",
            params![photo_id, stack_id, serde_json::to_string(&photo)?],
        )?;
    }
    touch_library(transaction)?;
    Ok(())
}
