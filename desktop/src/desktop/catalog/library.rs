use super::super::model::{Collection, LibraryManifest, Photo, Stack};
use super::super::{DesktopError, Library, Result};
use super::collections::{replace_stacks, upsert_collection};
use super::photos::insert_photo;
use super::{member_ids, now_millis, rows};
use rusqlite::{OptionalExtension, params};
use std::collections::HashMap;

impl Library {
    pub(in crate::desktop) fn load_library(&self) -> Result<Option<LibraryManifest>> {
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
        let photos = rows::<Photo>(
            &self.connection,
            "SELECT payload FROM photos ORDER BY imported_at",
        )?;
        let mut collections = rows::<Collection>(
            &self.connection,
            "SELECT payload FROM collections ORDER BY created_at",
        )?;
        for collection in &mut collections {
            collection.photo_ids = member_ids(
                &self.connection,
                "SELECT photo_id FROM collection_photos WHERE collection_id = ?1 ORDER BY position",
                &collection.id,
            )?;
        }
        let mut stacks = rows::<Stack>(&self.connection, "SELECT payload FROM stacks ORDER BY id")?;
        for stack in &mut stacks {
            stack.photo_ids = member_ids(
                &self.connection,
                "SELECT photo_id FROM stack_photos WHERE stack_id = ?1 ORDER BY position",
                &stack.id,
            )?;
        }
        Ok(Some(LibraryManifest {
            version: 1,
            created_at,
            updated_at,
            photos,
            collections,
            stacks,
        }))
    }

    pub(in crate::desktop) fn save_library(&mut self, manifest: &LibraryManifest) -> Result<()> {
        if manifest.version != 1 {
            return Err(DesktopError::Invalid(format!(
                "Unsupported library version {}",
                manifest.version
            )));
        }
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
            params![manifest.created_at, manifest.updated_at],
        )?;
        for photo in &manifest.photos {
            insert_photo(&transaction, photo)?;
        }
        for collection in &manifest.collections {
            upsert_collection(&transaction, collection)?;
        }
        replace_stacks(&transaction, &manifest.stacks, &HashMap::new())?;
        transaction.commit()?;
        Ok(())
    }

    pub(in crate::desktop) fn add_photos(
        &mut self,
        library_created_at: u64,
        photos: &[Photo],
        collection: Option<&Collection>,
    ) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO library (id, created_at, updated_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
            params![library_created_at, now_millis()],
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
