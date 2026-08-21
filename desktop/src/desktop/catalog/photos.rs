use super::super::model::{ImportResolution, PendingDelete, PendingDeleteKind, Photo};
use super::super::{DesktopError, Library, Result};
use super::{now_millis, touch_library};
use rusqlite::{OptionalExtension, Transaction, params};
use std::collections::HashMap;

impl Library {
    pub(in crate::desktop) fn resolve_imports(&self, photos: &[Photo]) -> Result<ImportResolution> {
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
            let fingerprint = photo.fingerprint();
            if let Some(existing) = resolved.get(&fingerprint) {
                photo_ids.insert(photo.id.clone(), existing.clone());
            } else {
                resolved.insert(fingerprint, photo.id.clone());
                photo_ids.insert(photo.id.clone(), photo.id.clone());
                additions.push(photo.clone());
            }
        }
        Ok(ImportResolution {
            additions,
            photo_ids,
        })
    }

    pub(in crate::desktop) fn update_photo(&mut self, photo: &Photo) -> Result<()> {
        let transaction = self.connection.transaction()?;
        let updated = transaction.execute(
            "UPDATE photos SET flagged = ?2, rejected = ?3, rating = ?4, stack_id = ?5, payload = ?6 WHERE id = ?1",
            params![
                photo.id,
                photo.flagged,
                photo.rejected,
                photo.rating,
                photo.stack_id,
                serde_json::to_string(photo)?
            ],
        )?;
        if updated == 0 {
            return Err(DesktopError::Invalid(format!(
                "Photo {} is missing",
                photo.id
            )));
        }
        touch_library(&transaction)?;
        transaction.commit()?;
        Ok(())
    }

    pub(in crate::desktop) fn delete_photo(
        &mut self,
        photo_id: &str,
        render_cache_name: String,
    ) -> Result<Vec<PendingDelete>> {
        let transaction = self.connection.transaction()?;
        let photo = transaction
            .query_row(
                "SELECT payload FROM photos WHERE id = ?1",
                [photo_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|payload| serde_json::from_str::<Photo>(&payload))
            .transpose()?;
        let Some(photo) = photo else {
            return Ok(Vec::new());
        };
        let queued_at = now_millis();
        let mut pending = photo
            .assets()
            .map(|asset| PendingDelete {
                kind: PendingDeleteKind::Original,
                storage_name: asset.storage_name.clone(),
                queued_at,
            })
            .collect::<Vec<_>>();
        if let Some(storage_name) = photo.thumbnail_storage_name {
            pending.push(PendingDelete {
                kind: PendingDeleteKind::Thumbnail,
                storage_name,
                queued_at,
            });
        }
        pending.extend([
            PendingDelete {
                kind: PendingDeleteKind::Edit,
                storage_name: format!("{photo_id}.json"),
                queued_at,
            },
            PendingDelete {
                kind: PendingDeleteKind::Derived,
                storage_name: render_cache_name,
                queued_at,
            },
        ]);
        for deletion in &pending {
            transaction.execute(
                "INSERT INTO pending_deletes (kind, storage_name, queued_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(kind, storage_name) DO UPDATE SET queued_at = excluded.queued_at",
                params![
                    deletion.kind.as_str(),
                    deletion.storage_name,
                    deletion.queued_at
                ],
            )?;
        }
        transaction.execute("DELETE FROM photos WHERE id = ?1", [photo_id])?;
        touch_library(&transaction)?;
        transaction.commit()?;
        Ok(pending)
    }
}

pub(super) fn insert_photo(transaction: &Transaction<'_>, photo: &Photo) -> Result<()> {
    let captured_at = photo
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.captured_at.as_deref());
    transaction.execute(
        "INSERT INTO photos
         (id, fingerprint, imported_at, captured_at, flagged, rejected, rating, stack_id, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            photo.id,
            photo.fingerprint(),
            photo.imported_at,
            captured_at,
            photo.flagged,
            photo.rejected,
            photo.rating,
            photo.stack_id,
            serde_json::to_string(photo)?
        ],
    )?;
    for (frame_index, frame) in photo.frames.iter().enumerate() {
        for (role, asset) in [
            frame.raw.as_ref().map(|asset| ("raw", asset)),
            frame.display.as_ref().map(|asset| ("display", asset)),
        ]
        .into_iter()
        .flatten()
        {
            transaction.execute(
                "INSERT INTO assets
                 (id, storage_name, content_hash, photo_id, frame_index, role, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    asset.id,
                    asset.storage_name,
                    asset.content_hash,
                    photo.id,
                    frame_index,
                    role,
                    serde_json::to_string(asset)?
                ],
            )?;
        }
    }
    Ok(())
}
