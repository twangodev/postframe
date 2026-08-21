use super::super::model::Preset;
use super::super::{Library, Result};
use super::rows;
use rusqlite::params;

impl Library {
    pub(in crate::desktop) fn list_presets(&self) -> Result<Vec<Preset>> {
        rows(
            &self.connection,
            "SELECT payload FROM presets ORDER BY updated_at DESC",
        )
    }

    pub(in crate::desktop) fn save_preset(&self, preset: &Preset) -> Result<()> {
        self.connection.execute(
            "INSERT INTO presets (id, normalized_name, updated_at, payload) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET normalized_name = excluded.normalized_name, updated_at = excluded.updated_at, payload = excluded.payload",
            params![
                preset.id,
                preset.normalized_name,
                preset.updated_at,
                serde_json::to_string(preset)?
            ],
        )?;
        Ok(())
    }

    pub(in crate::desktop) fn delete_preset(&self, preset_id: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM presets WHERE id = ?1", [preset_id])?;
        Ok(())
    }
}
