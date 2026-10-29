use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Where the Anthropic key lives in the system keychain.
const KEY_SERVICE: &str = "app.shoji.desktop";
const KEY_ACCOUNT: &str = "anthropic";

/// The running thread's runtime process and its run number. M1 runs one thread at a time.
#[derive(Default)]
struct Run {
    child: Mutex<Option<(u64, CommandChild)>>,
    count: AtomicU64,
}

fn key_entry() -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT)
}

fn saved_key() -> Option<String> {
    key_entry().and_then(|entry| entry.get_password()).ok()
}

/// A key from the shell, for development. An app opened from the Dock or Start menu won't see one.
fn env_key() -> Option<String> {
    ["SHOJI_API_KEY", "ANTHROPIC_API_KEY"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyStatus {
    saved: bool,
    from_env: bool,
}

#[tauri::command]
fn key_status() -> KeyStatus {
    KeyStatus {
        saved: saved_key().is_some(),
        from_env: env_key().is_some(),
    }
}

#[tauri::command]
fn save_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Paste a key first.".into());
    }
    key_entry()
        .and_then(|entry| entry.set_password(key))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn forget_key() -> Result<(), String> {
    match key_entry().and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn pick_project(app: AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open a project")
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.display().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    repo: String,
    task: String,
    stack: String,
    /// Dollars this run may spend.
    cap: f64,
    /// Set when the person asks for changes to finished work, with that work's plan.
    changes: Option<Changes>,
}

#[derive(Deserialize)]
struct Changes {
    notes: String,
    plan: String,
}

#[derive(Clone, Serialize)]
struct RunEvent {
    run: u64,
    event: serde_json::Value,
}

#[derive(Clone, Serialize)]
struct Exit {
    run: u64,
    code: Option<i32>,
    /// What the runtime wrote to stderr, such as why it couldn't start.
    error: String,
}

/// Starts the runtime on a task and returns its run number. The run's events arrive as
/// `runtime-event`, then one `runtime-exit`, each carrying that number.
#[tauri::command]
fn start_run(app: AppHandle, run: State<Run>, request: RunRequest) -> Result<u64, String> {
    let mut slot = run.child.lock().unwrap();
    if slot.is_some() {
        return Err("A thread is already running.".into());
    }
    let key = saved_key()
        .or_else(env_key)
        .ok_or("Add your Anthropic API key in Settings first.")?;

    // Every event is kept on disk, so receipts have each call's tokens and cost.
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runs = data.join("runs");
    fs::create_dir_all(&runs).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let log = runs.join(format!("{stamp}.jsonl"));

    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        request.repo,
        "--task".into(),
        request.task,
        "--stack".into(),
        request.stack,
        "--cap".into(),
        format!("{:.4}", request.cap),
        "--log".into(),
        log.display().to_string(),
    ];
    if let Some(changes) = request.changes {
        let plan = runs.join(format!("{stamp}-plan.md"));
        fs::write(&plan, changes.plan).map_err(|e| e.to_string())?;
        args.extend([
            "--changes".into(),
            changes.notes,
            "--plan-file".into(),
            plan.display().to_string(),
        ]);
    }

    let (mut events, child) = app
        .shell()
        .sidecar("shoji-runtime")
        .map_err(|e| e.to_string())?
        .args(args)
        .env("SHOJI_API_KEY", key)
        .spawn()
        .map_err(|e| e.to_string())?;
    let id = run.count.fetch_add(1, Ordering::Relaxed) + 1;
    *slot = Some((id, child));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stderr = Vec::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if let Ok(event) = serde_json::from_slice::<serde_json::Value>(&line) {
                        let _ = app.emit("runtime-event", RunEvent { run: id, event });
                    }
                }
                CommandEvent::Stderr(line) => {
                    stderr.push(String::from_utf8_lossy(&line).trim_end().to_string())
                }
                CommandEvent::Terminated(status) => {
                    let state = app.state::<Run>();
                    let mut slot = state.child.lock().unwrap();
                    if slot.as_ref().is_some_and(|(run, _)| *run == id) {
                        slot.take();
                    }
                    drop(slot);
                    let exit = Exit {
                        run: id,
                        code: status.code,
                        error: stderr.join("\n").trim().to_string(),
                    };
                    let _ = app.emit("runtime-exit", exit);
                }
                _ => {}
            }
        }
    });
    Ok(id)
}

#[tauri::command]
fn stop_run(run: State<Run>) -> Result<(), String> {
    if let Some((_, child)) = run.child.lock().unwrap().take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Run::default())
        .invoke_handler(tauri::generate_handler![
            key_status,
            save_key,
            forget_key,
            pick_project,
            start_run,
            stop_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
