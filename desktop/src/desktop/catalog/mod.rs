mod collections;
mod library;
mod photos;
mod presets;
mod recovery;
mod schema;

use super::{DesktopError, Result};
use rusqlite::{Connection, Transaction};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) use schema::initialize_schema;

fn rows<T: DeserializeOwned>(connection: &Connection, query: &str) -> Result<Vec<T>> {
    let mut statement = connection.prepare(query)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

fn strings(connection: &Connection, query: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(query)?;
    statement
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(DesktopError::from)
}

fn member_ids(connection: &Connection, query: &str, id: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(query)?;
    statement
        .query_map([id], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(DesktopError::from)
}

fn touch_library(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute(
        "UPDATE library SET updated_at = ?1 WHERE id = 1",
        [now_millis()],
    )?;
    Ok(())
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn collect_mask_names(value: &Value, names: &mut HashSet<String>) {
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_millis() as u64
}
