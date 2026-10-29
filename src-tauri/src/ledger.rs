//! The ledger: every thread, run and model call, kept in a SQLite file on this machine.
//! Receipts read from it. Nothing in it leaves the machine.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

/// Each entry moves the schema up one version, in order. Never edit one that has shipped.
const MIGRATIONS: &[&str] = &["
    CREATE TABLE threads (
        id INTEGER PRIMARY KEY,
        task TEXT NOT NULL,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        stack TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        committed TEXT,
        committed_at INTEGER
    );
    CREATE TABLE runs (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES threads(id),
        kind TEXT NOT NULL,
        log TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        status TEXT
    );
    CREATE TABLE calls (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        at INTEGER NOT NULL,
        role TEXT NOT NULL,
        step TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        seconds REAL NOT NULL
    );
    CREATE INDEX runs_by_thread ON runs(thread_id);
    CREATE INDEX calls_by_run ON calls(run_id);
"];

pub struct Ledger(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRecord {
    pub id: i64,
    pub task: String,
    pub repo: String,
    pub branch: String,
    pub stack: String,
    /// Milliseconds since 1970, as are the other times here.
    pub started_at: i64,
    pub committed: Option<String>,
    pub committed_at: Option<i64>,
    pub runs: Vec<RunRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: i64,
    /// "task" or "changes".
    pub kind: String,
    pub started_at: i64,
    /// ready, needs-work, stopped or failed; none while the run is going.
    pub status: Option<String>,
    pub calls: Vec<CallRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRecord {
    pub at: i64,
    pub role: String,
    pub step: String,
    pub model: String,
    pub effort: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_write_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost: f64,
    pub seconds: f64,
}

type Result<T> = rusqlite::Result<T>;

impl Ledger {
    /// Opens the ledger file. No run can be going while the app starts, so a run left
    /// without an ending, by a crash or a forced quit, is marked failed.
    pub fn open(path: &Path) -> Result<Self> {
        let ledger = Self::with(Connection::open(path)?)?;
        ledger
            .0
            .lock()
            .unwrap()
            .execute("UPDATE runs SET status = 'failed' WHERE status IS NULL", [])?;
        Ok(ledger)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::with(Connection::open_in_memory()?)
    }

    fn with(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        for (i, migration) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            conn.execute_batch(&format!(
                "BEGIN; {migration} PRAGMA user_version = {}; COMMIT;",
                i + 1
            ))?;
        }
        Ok(Self(Mutex::new(conn)))
    }

    pub fn start_thread(
        &self,
        task: &str,
        repo: &str,
        branch: &str,
        stack: &str,
        at: i64,
    ) -> Result<i64> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO threads (task, repo, branch, stack, started_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![task, repo, branch, stack, at],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn start_run(&self, thread: i64, kind: &str, log: &str, at: i64) -> Result<i64> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO runs (thread_id, kind, log, started_at) VALUES (?1, ?2, ?3, ?4)",
            params![thread, kind, log, at],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Keeps what receipts need from one runtime event: each call, and how the run ended.
    pub fn record(&self, run: i64, event: &Value, at: i64) -> Result<()> {
        match event["type"].as_str() {
            Some("call") => {
                let call = &event["call"];
                let text = |key: &str| call[key].as_str().unwrap_or_default().to_string();
                let count = |key: &str| call[key].as_i64().unwrap_or(0);
                let number = |key: &str| call[key].as_f64().unwrap_or(0.0);
                self.0.lock().unwrap().execute(
                    "INSERT INTO calls (run_id, at, role, step, model, effort, input_tokens, output_tokens,
                        cache_write_tokens, cache_read_tokens, cost, seconds)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        run,
                        at,
                        text("role"),
                        text("step"),
                        text("model"),
                        text("effort"),
                        count("inputTokens"),
                        count("outputTokens"),
                        count("cacheWriteTokens"),
                        count("cacheReadTokens"),
                        number("cost"),
                        number("seconds"),
                    ],
                )?;
            }
            Some("result") => {
                if let Some(status) = event["result"]["status"].as_str() {
                    self.0.lock().unwrap().execute(
                        "UPDATE runs SET status = ?2 WHERE id = ?1",
                        params![run, status],
                    )?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Marks a run that ended without its result, unless it already has one.
    pub fn end_run(&self, run: i64, status: &str) -> Result<()> {
        self.0.lock().unwrap().execute(
            "UPDATE runs SET status = ?2 WHERE id = ?1 AND status IS NULL",
            params![run, status],
        )?;
        Ok(())
    }

    pub fn commit(&self, thread: i64, sha: &str, at: i64) -> Result<()> {
        self.0.lock().unwrap().execute(
            "UPDATE threads SET committed = ?2, committed_at = ?3 WHERE id = ?1",
            params![thread, sha, at],
        )?;
        Ok(())
    }

    /// Every thread with its runs and their calls, newest thread first.
    pub fn threads(&self) -> Result<Vec<ThreadRecord>> {
        let conn = self.0.lock().unwrap();
        let mut threads = conn
            .prepare(
                "SELECT id, task, repo, branch, stack, started_at, committed, committed_at
                 FROM threads ORDER BY started_at DESC, id DESC",
            )?
            .query_map([], |row| {
                Ok(ThreadRecord {
                    id: row.get(0)?,
                    task: row.get(1)?,
                    repo: row.get(2)?,
                    branch: row.get(3)?,
                    stack: row.get(4)?,
                    started_at: row.get(5)?,
                    committed: row.get(6)?,
                    committed_at: row.get(7)?,
                    runs: Vec::new(),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        let mut runs = conn.prepare(
            "SELECT id, kind, started_at, status FROM runs WHERE thread_id = ?1 ORDER BY started_at, id",
        )?;
        let mut calls = conn.prepare(
            "SELECT at, role, step, model, effort, input_tokens, output_tokens, cache_write_tokens,
                cache_read_tokens, cost, seconds
             FROM calls WHERE run_id = ?1 ORDER BY at, id",
        )?;
        for thread in &mut threads {
            thread.runs = runs
                .query_map([thread.id], |row| {
                    Ok(RunRecord {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        started_at: row.get(2)?,
                        status: row.get(3)?,
                        calls: Vec::new(),
                    })
                })?
                .collect::<Result<Vec<_>>>()?;
            for run in &mut thread.runs {
                run.calls = calls
                    .query_map([run.id], |row| {
                        Ok(CallRecord {
                            at: row.get(0)?,
                            role: row.get(1)?,
                            step: row.get(2)?,
                            model: row.get(3)?,
                            effort: row.get(4)?,
                            input_tokens: row.get(5)?,
                            output_tokens: row.get(6)?,
                            cache_write_tokens: row.get(7)?,
                            cache_read_tokens: row.get(8)?,
                            cost: row.get(9)?,
                            seconds: row.get(10)?,
                        })
                    })?
                    .collect::<Result<Vec<_>>>()?;
            }
        }
        Ok(threads)
    }

    /// The thread a run belongs to, for checking a request for changes names a real thread.
    pub fn has_thread(&self, thread: i64) -> Result<bool> {
        self.0
            .lock()
            .unwrap()
            .query_row("SELECT 1 FROM threads WHERE id = ?1", [thread], |_| Ok(()))
            .optional()
            .map(|found| found.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(role: &str, model: &str, cost: f64) -> Value {
        json!({
            "type": "call",
            "call": {
                "role": role, "step": role, "model": model, "effort": "low",
                "inputTokens": 10, "outputTokens": 20, "cacheWriteTokens": 30, "cacheReadTokens": 40,
                "cost": cost, "seconds": 1.5
            }
        })
    }

    #[test]
    fn keeps_threads_runs_and_calls() {
        let ledger = Ledger::in_memory().unwrap();
        let thread = ledger
            .start_thread(
                "Add a toggle",
                "/work/app",
                "shoji/add-a-toggle",
                "balanced",
                1000,
            )
            .unwrap();
        let run = ledger
            .start_run(thread, "task", "/logs/1.jsonl", 1001)
            .unwrap();
        ledger
            .record(run, &call("plan", "claude-opus-5-5", 0.05), 1002)
            .unwrap();
        ledger
            .record(
                run,
                &json!({ "type": "tool", "tool": "read", "target": "a.ts" }),
                1003,
            )
            .unwrap();
        ledger
            .record(run, &call("build", "claude-sonnet-5-5", 0.02), 1004)
            .unwrap();
        ledger
            .record(
                run,
                &json!({ "type": "result", "result": { "status": "ready" } }),
                1005,
            )
            .unwrap();
        ledger.end_run(run, "failed").unwrap();
        let changes = ledger
            .start_run(thread, "changes", "/logs/2.jsonl", 2000)
            .unwrap();
        ledger.end_run(changes, "stopped").unwrap();
        ledger.commit(thread, "abc1234", 3000).unwrap();

        let threads = ledger.threads().unwrap();
        assert_eq!(threads.len(), 1);
        let t = &threads[0];
        assert_eq!(
            (t.task.as_str(), t.committed.as_deref(), t.committed_at),
            ("Add a toggle", Some("abc1234"), Some(3000))
        );
        assert_eq!(t.runs.len(), 2);
        assert_eq!(t.runs[0].status.as_deref(), Some("ready"));
        assert_eq!(t.runs[1].status.as_deref(), Some("stopped"));
        let calls = &t.runs[0].calls;
        assert_eq!(calls.len(), 2);
        assert_eq!(
            (calls[0].role.as_str(), calls[0].model.as_str()),
            ("plan", "claude-opus-5-5")
        );
        assert_eq!((calls[1].cache_read_tokens, calls[1].cost), (40, 0.02));
    }

    #[test]
    fn lists_the_newest_thread_first() {
        let ledger = Ledger::in_memory().unwrap();
        ledger
            .start_thread("First", "/r", "shoji/first", "balanced", 1)
            .unwrap();
        let second = ledger
            .start_thread("Second", "/r", "shoji/second", "haiku", 2)
            .unwrap();
        let threads = ledger.threads().unwrap();
        assert_eq!(
            threads.iter().map(|t| t.task.as_str()).collect::<Vec<_>>(),
            ["Second", "First"]
        );
        assert!(ledger.has_thread(second).unwrap());
        assert!(!ledger.has_thread(99).unwrap());
    }

    #[test]
    fn reopening_keeps_the_ledger() {
        let dir = std::env::temp_dir().join(format!("shoji-ledger-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shoji.db");
        let _ = std::fs::remove_file(&path);
        {
            let ledger = Ledger::open(&path).unwrap();
            let thread = ledger
                .start_thread("Kept", "/r", "shoji/kept", "balanced", 1)
                .unwrap();
            ledger.start_run(thread, "task", "/logs/1.jsonl", 2).unwrap();
        }
        let ledger = Ledger::open(&path).unwrap();
        let threads = ledger.threads().unwrap();
        assert_eq!(threads[0].task, "Kept");
        // The app closed while the run was going, so it can't still be running.
        assert_eq!(threads[0].runs[0].status.as_deref(), Some("failed"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
