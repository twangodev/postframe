use super::super::Result;
use rusqlite::Connection;

pub(in crate::desktop) fn initialize_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            camera_match_preference TEXT NOT NULL DEFAULT 'ask'
                CHECK (camera_match_preference IN ('ask', 'always', 'never'))
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
        PRAGMA user_version = 2;",
    )?;
    ensure_camera_match_preference(connection)?;
    Ok(())
}

fn ensure_camera_match_preference(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(library)")?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for column in columns {
        if column? == "camera_match_preference" {
            return Ok(());
        }
    }
    connection.execute(
        "ALTER TABLE library ADD COLUMN camera_match_preference TEXT NOT NULL DEFAULT 'ask'
         CHECK (camera_match_preference IN ('ask', 'always', 'never'))",
        [],
    )?;
    Ok(())
}
