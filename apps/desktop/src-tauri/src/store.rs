//! Rig's own data on this PC: settings, temperature history and the change
//! log, in one SQLite file in the app's data folder. Values are JSON the
//! TypeScript side owns; this file only stores and finds them.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::{path::Path, sync::Mutex};

pub struct Store(Mutex<Connection>);

/// History older than this is dropped (the account keeps 30 days too).
const KEEP_MS: i64 = 90 * 24 * 3600 * 1000;

type R<T> = Result<T, String>;
fn e(err: impl std::fmt::Display) -> String { err.to_string() }

impl Store {
    pub fn open(path: &Path) -> R<Self> {
        let db = Connection::open(path).map_err(e)?;
        Self::init(db)
    }

    #[cfg(test)]
    pub fn memory() -> R<Self> { Self::init(Connection::open_in_memory().map_err(e)?) }

    fn init(db: Connection) -> R<Self> {
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS history (t INTEGER PRIMARY KEY, point TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, at TEXT NOT NULL, change TEXT NOT NULL);",
        ).map_err(e)?;
        Ok(Self(Mutex::new(db)))
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> { self.0.lock().unwrap_or_else(|p| p.into_inner()) }

    pub fn get(&self, key: &str) -> R<Option<Value>> {
        let v: Option<String> = self.db().query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().map_err(e)?;
        v.map(|s| serde_json::from_str(&s).map_err(e)).transpose()
    }

    pub fn set(&self, key: &str, value: &Value) -> R<()> {
        self.db().execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value.to_string()]).map_err(e)?;
        Ok(())
    }

    pub fn add_history(&self, point: &Value) -> R<()> {
        let t = point.get("t").and_then(Value::as_i64).ok_or("A history point needs a time.")?;
        let db = self.db();
        db.execute("INSERT OR REPLACE INTO history (t, point) VALUES (?1, ?2)", params![t, point.to_string()]).map_err(e)?;
        db.execute("DELETE FROM history WHERE t < ?1", [t - KEEP_MS]).map_err(e)?;
        Ok(())
    }

    pub fn history_since(&self, since: i64) -> R<Vec<Value>> {
        let db = self.db();
        let mut q = db.prepare("SELECT point FROM history WHERE t >= ?1 ORDER BY t").map_err(e)?;
        let rows = q.query_map([since], |r| r.get::<_, String>(0)).map_err(e)?;
        rows.map(|s| serde_json::from_str(&s.map_err(e)?).map_err(e)).collect()
    }

    pub fn changes(&self) -> R<Vec<Value>> {
        let db = self.db();
        let mut q = db.prepare("SELECT change FROM changes ORDER BY at DESC").map_err(e)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(e)?;
        rows.map(|s| serde_json::from_str(&s.map_err(e)?).map_err(e)).collect()
    }

    pub fn put_change(&self, change: &Value) -> R<()> {
        let id = change.get("id").and_then(Value::as_str).ok_or("A change needs an id.")?;
        let at = change.get("at").and_then(Value::as_str).unwrap_or_default();
        self.db().execute("INSERT OR REPLACE INTO changes (id, at, change) VALUES (?1, ?2, ?3)", params![id, at, change.to_string()]).map_err(e)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_values_history_and_changes() {
        let s = Store::memory().unwrap();
        assert_eq!(s.get("identity").unwrap(), None);
        s.set("identity", &json!({"name": "Atlas"})).unwrap();
        assert_eq!(s.get("identity").unwrap(), Some(json!({"name": "Atlas"})));

        let day: i64 = 24 * 3600 * 1000;
        s.add_history(&json!({"t": 1_000, "cpu": 50})).unwrap();
        s.add_history(&json!({"t": 1_000 + 100 * day, "cpu": 60})).unwrap();
        // The first point is older than 90 days by then and gets dropped.
        assert_eq!(s.history_since(0).unwrap().len(), 1);

        s.put_change(&json!({"id": "a", "at": "2026-01-01T00:00:00Z", "status": "applied"})).unwrap();
        s.put_change(&json!({"id": "a", "at": "2026-01-01T00:00:00Z", "status": "undone"})).unwrap();
        s.put_change(&json!({"id": "b", "at": "2026-02-01T00:00:00Z", "status": "applied"})).unwrap();
        let c = s.changes().unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0]["id"], "b");
        assert_eq!(c[1]["status"], "undone");
    }
}
