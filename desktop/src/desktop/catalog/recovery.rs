use super::super::model::{AssetKind, PendingDelete, PendingDeleteKind, Photo, StorageReferences};
use super::super::{Library, Result};
use super::{collect_mask_names, rows, strings};
use rusqlite::params;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;

impl Library {
    pub(in crate::desktop) fn pending_deletions(&self) -> Result<Vec<PendingDelete>> {
        let mut statement = self.connection.prepare(
            "SELECT kind, storage_name, queued_at FROM pending_deletes ORDER BY queued_at",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;
        rows.map(|row| {
            let (kind, storage_name, queued_at) = row?;
            Ok(PendingDelete {
                kind: kind.parse::<PendingDeleteKind>()?,
                storage_name,
                queued_at,
            })
        })
        .collect()
    }

    pub(in crate::desktop) fn complete_deletions(
        &mut self,
        deletions: &[PendingDelete],
    ) -> Result<()> {
        let transaction = self.connection.transaction()?;
        for deletion in deletions {
            transaction.execute(
                "DELETE FROM pending_deletes WHERE kind = ?1 AND storage_name = ?2",
                params![deletion.kind.as_str(), deletion.storage_name],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub(in crate::desktop) fn storage_references(&self) -> Result<StorageReferences> {
        let originals = strings(&self.connection, "SELECT storage_name FROM assets")?;
        let photo_ids = strings(&self.connection, "SELECT id FROM photos")?;
        let thumbnails = rows::<Photo>(&self.connection, "SELECT payload FROM photos")?
            .into_iter()
            .filter_map(|photo| photo.thumbnail_storage_name)
            .collect();
        let edits = photo_ids
            .iter()
            .map(|id| format!("{id}.json"))
            .collect::<Vec<_>>();
        let mut masks = HashSet::new();
        for edit in &edits {
            let path = self.root.join(AssetKind::Edits.directory()).join(edit);
            let Ok(contents) = fs::read(path) else {
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
    }
}
