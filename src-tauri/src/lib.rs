mod ledger;
mod push;
#[cfg(unix)]
mod shell_path;
mod slash;
mod server;
mod terminal;
#[cfg(target_os = "macos")]
mod titlebar;
mod worktree;

use std::fs;
use std::path::{Component, Path};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use ledger::{Ledger, ThreadRecord};
use server::Servers;
use terminal::Terminals;

/// Where the Anthropic key lives in the system keychain.
const KEY_SERVICE: &str = "app.shoji.desktop";
const KEY_ACCOUNT: &str = "anthropic";

/// A runtime process that's going: its run in the ledger, and the thread it works on.
struct Live {
    child: CommandChild,
    entry: i64,
    thread: i64,
}

/// Every runtime process that's going, by run number. Threads work in their own copies of the
/// project, so several run at once, alongside a trial or project notes.
#[derive(Default)]
struct Run {
    live: Mutex<HashMap<u64, Live>>,
    count: AtomicU64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The ledger must never stop a run, so a failed write is only reported.
fn noted<T>(result: rusqlite::Result<T>) -> Option<T> {
    result.map_err(|e| eprintln!("ledger: {e}")).ok()
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

/// Keeps the key from the shell in the keychain, so Shoji has it however it's opened. The key itself
/// never goes to the window.
#[tauri::command]
fn use_shell_key() -> Result<(), String> {
    let key = env_key().ok_or("No key was found in the shell.")?;
    save_key(key)
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

#[tauri::command]
async fn pick_attachments(app: AppHandle) -> Vec<String> {
    app.dialog()
        .file()
        .set_title("Attach screenshots or files")
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| path.display().to_string())
        .collect()
}

/// The most a pasted screenshot may weigh, which is the most a model takes for one image.
const MAX_PASTED_BYTES: usize = 5 * 1024 * 1024;

/// Keeps a pasted screenshot as a file in the app's data, so a run can attach it like any other.
#[tauri::command]
fn save_attachment(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_PASTED_BYTES {
        return Err("That image is over 5 MB, the most a model takes for one image.".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{}-{}", now_ms(), attachment_name(&name)));
    fs::write(&file, bytes).map_err(|e| e.to_string())?;
    Ok(file.display().to_string())
}

/// A file name with nothing that could reach outside the folder it's written to.
fn attachment_name(name: &str) -> String {
    let kept: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let kept = kept.trim_start_matches('.');
    if kept.is_empty() { "pasted.png".into() } else { kept.into() }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    repo: String,
    task: String,
    /// Each role's model and effort, as the runtime's --stack-json takes it.
    stack: serde_json::Value,
    /// Dollars this run may spend.
    cap: f64,
    /// Set when the run carries on a thread: changes to its work, or building or replanning its plan.
    changes: Option<Changes>,
    /// Stop once the plan is written, for the person to build or change it.
    #[serde(default)]
    plan_only: bool,
    /// Screenshots and files the person attached to the thread's task.
    #[serde(default)]
    attachments: Vec<String>,
    /// Commands beyond the checks that the person allowed in this project.
    #[serde(default)]
    allowed_commands: Vec<String>,
    /// Patterns for files no role may read, change or list. None keeps the runtime's own.
    private_files: Option<Vec<String>>,
    /// The downloaded model list, as the runtime's --models-json takes it. None keeps the built-in one.
    models: Option<serde_json::Value>,
    /// What the person asked for, as the thread shows it, kept so a reopened thread can show it again.
    ask: Option<String>,
    /// The person's MCP servers, as the runtime's --mcp-json takes them.
    mcp_servers: Option<serde_json::Value>,
    /// The project's dev command, which Build may start to look at pages. None or empty: Build doesn't look.
    dev_command: Option<String>,
}

/// The runtime's --private flags. An empty list is passed as one empty pattern, which keeps
/// nothing private, since no flag at all means the runtime's defaults.
fn private_args(patterns: &Option<Vec<String>>) -> Vec<String> {
    match patterns {
        None => vec![],
        Some(list) if list.is_empty() => vec!["--private=".into()],
        Some(list) => list.iter().map(|pattern| format!("--private={pattern}")).collect(),
    }
}

/// The runtime's --models-json flag, joined with = so the list can't be read as a flag of its own.
fn models_args(models: &Option<serde_json::Value>) -> Vec<String> {
    models.iter().map(|list| format!("--models-json={list}")).collect()
}

/// The runtime's --mcp-json flag, joined with = in the same way.
fn mcp_args(servers: &Option<serde_json::Value>) -> Vec<String> {
    servers.iter().map(|list| format!("--mcp-json={list}")).collect()
}

#[derive(Serialize)]
struct Started {
    run: u64,
    /// The thread's id in the ledger.
    thread: i64,
    /// The thread's branch, where its work is committed.
    branch: String,
    /// The thread's own copy of the project, where its work happens. None for an older thread
    /// that works in the project itself.
    workdir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Changes {
    /// The thread in the ledger these changes belong to.
    thread: i64,
    notes: String,
    plan: String,
    /// The thread's branch, which the project must still be on.
    branch: String,
    /// "changes" to the work (the default), "build" for an approved plan, "replan" for notes
    /// on the plan, or "question" for a question about the work, which changes nothing.
    #[serde(default)]
    kind: Option<String>,
    /// Checks that failed before the thread's first build, which these changes leave alone.
    #[serde(default)]
    failing_before: Vec<String>,
    /// The failures those checks named then, so a new one inside them still counts.
    #[serde(default)]
    failing_tests_before: Vec<String>,
}

impl Changes {
    fn kind(&self) -> &str {
        match self.kind.as_deref() {
            Some("build") => "build",
            Some("replan") => "replan",
            Some("question") => "question",
            _ => "changes",
        }
    }
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
/// `runtime-event`, then one `runtime-exit`, each carrying that number. A new task gets
/// its own branch, in its own copy of the project; changes carry on in the thread's copy.
#[tauri::command]
fn start_run(
    app: AppHandle,
    run: State<Run>,
    ledger: State<Ledger>,
    request: RunRequest,
) -> Result<Started, String> {
    let ask = request.ask.clone();
    let mut live = run.live.lock().unwrap();
    if let Some(changes) = &request.changes {
        if live.values().any(|l| l.thread == changes.thread) {
            return Err("This thread is already running.".into());
        }
    }
    let key = saved_key()
        .or_else(env_key)
        .ok_or("Add your Anthropic API key in Settings first.")?;

    // Every event is kept on disk, so receipts have each call's tokens and cost.
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runs = data.join("runs");
    fs::create_dir_all(&runs).map_err(|e| e.to_string())?;
    let stamp = now_ms();
    let log = runs.join(format!("{stamp}.jsonl"));

    let repo = request.repo;
    if let Some(changes) = &request.changes {
        if !ledger.has_thread(changes.thread).map_err(|e| e.to_string())? {
            return Err("That thread isn't in the ledger.".into());
        }
    }
    // Where the work happens: the thread's own copy, made now for a new task.
    let (branch, workdir, made) = match &request.changes {
        Some(changes) => match ledger.workdir_of(changes.thread).map_err(|e| e.to_string())? {
            Some(dir) => {
                worktree::restore(&repo, Path::new(&dir), &changes.branch)?;
                (on_branch(&dir, &changes.branch)?, Some(dir), false)
            }
            None => (on_branch(&repo, &changes.branch)?, None, false),
        },
        None => {
            let (branch, dir) = worktree::create(&repo, &data.join("worktrees"), &request.task)?;
            (branch, Some(dir.display().to_string()), true)
        }
    };
    let dir = workdir.clone().unwrap_or_else(|| repo.clone());

    let task = request.task.clone();
    let stack = request.stack.to_string();
    let thread = request.changes.as_ref().map(|c| (c.thread, c.kind().to_string()));
    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        dir.clone(),
        "--task".into(),
        request.task,
        "--stack-json".into(),
        stack.clone(),
        "--cap".into(),
        format!("{:.4}", request.cap),
        "--log".into(),
        log.display().to_string(),
    ];
    if request.plan_only {
        args.push("--plan-only".into());
    }
    args.extend(request.attachments.iter().map(|file| format!("--attach={file}")));
    args.extend(request.allowed_commands.iter().map(|command| format!("--allow={command}")));
    args.extend(private_args(&request.private_files));
    args.extend(models_args(&request.models));
    args.extend(mcp_args(&request.mcp_servers));
    // Joined with = so the command can't be read as a flag of its own.
    args.extend(request.dev_command.iter().filter(|c| !c.trim().is_empty()).map(|c| format!("--dev-command={c}")));
    if let Some(changes) = request.changes {
        let plan = runs.join(format!("{stamp}-plan.md"));
        fs::write(&plan, &changes.plan).map_err(|e| e.to_string())?;
        args.extend(["--plan-file".into(), plan.display().to_string()]);
        // Joined with = so a command can't be read as a flag of its own.
        args.extend(changes.failing_before.iter().map(|command| format!("--failing-before={command}")));
        args.extend(changes.failing_tests_before.iter().map(|name| format!("--failing-test-before={name}")));
        match changes.kind() {
            "build" => args.push("--build".into()),
            kind => args.extend([format!("--{kind}"), changes.notes]),
        }
    }

    // The ledger keeps the thread and run first, so every call the run makes has a home.
    let recorded = match thread {
        Some((thread, kind)) => Ok((thread, kind)),
        None => ledger.start_thread(&task, &repo, &branch, &stack, stamp).and_then(|thread| {
            ledger.note_workdir(thread, &dir)?;
            Ok((thread, "task".to_string()))
        }),
    }
    .and_then(|(thread, kind)| {
        let entry = ledger.start_run(thread, &kind, &log.display().to_string(), stamp)?;
        if let Some(ask) = &ask {
            ledger.note_ask(entry, ask)?;
        }
        Ok((thread, entry))
    })
    .map_err(|e| e.to_string());
    let spawned = recorded.and_then(|ids| {
        let command = app.shell().sidecar("shoji-runtime").map_err(|e| e.to_string())?;
        let spawned = command
            .args(args)
            .env("SHOJI_API_KEY", key)
            .spawn()
            .map_err(|e| {
                noted(ledger.end_run(ids.1, "failed"));
                e.to_string()
            })?;
        Ok((ids, spawned))
    });
    let ((thread, entry), (events, child)) = match spawned {
        Ok(spawned) => spawned,
        Err(e) => {
            // Leave the project as it was found.
            if made {
                worktree::remove(&repo, &dir);
                let _ = git(&repo, &["branch", "--quiet", "-D", &branch]);
            }
            return Err(e);
        }
    };
    let id = run.count.fetch_add(1, Ordering::Relaxed) + 1;
    live.insert(id, Live { child, entry, thread });
    watch(app, events, id, entry);
    Ok(Started { run: id, thread, branch, workdir })
}

/// Passes a run's events to the app and the ledger until the runtime exits.
fn watch(app: AppHandle, mut events: Receiver<CommandEvent>, id: u64, entry: i64) {
    tauri::async_runtime::spawn(async move {
        let mut stderr = Vec::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if let Ok(event) = serde_json::from_slice::<serde_json::Value>(&line) {
                        noted(app.state::<Ledger>().record(entry, &event, now_ms()));
                        let _ = app.emit("runtime-event", RunEvent { run: id, event });
                    }
                }
                CommandEvent::Stderr(line) => {
                    stderr.push(String::from_utf8_lossy(&line).trim_end().to_string())
                }
                CommandEvent::Terminated(status) => {
                    app.state::<Run>().live.lock().unwrap().remove(&id);
                    noted(app.state::<Ledger>().end_run(entry, "failed"));
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrialRequest {
    repo: String,
    /// What the trial tries, in words, as the ledger and Receipts name it.
    label: String,
    /// The candidate stack, as the runtime's --stack-json takes it.
    stack: serde_json::Value,
    /// Dollars the whole trial may spend.
    cap: f64,
    /// The accepted tasks to replay: {task, commit, was}, as the runtime's --trial-file takes them.
    tasks: Vec<serde_json::Value>,
    /// Patterns for files no role may read, change or list. None keeps the runtime's own.
    private_files: Option<Vec<String>>,
    /// The downloaded model list, as the runtime's --models-json takes it. None keeps the built-in one.
    models: Option<serde_json::Value>,
}

/// Replays accepted tasks on a candidate stack in scratch copies of the project. The project
/// itself is never touched. Its events and exit arrive like a thread's, under its run number.
#[tauri::command]
fn start_trial(
    app: AppHandle,
    run: State<Run>,
    ledger: State<Ledger>,
    request: TrialRequest,
) -> Result<u64, String> {
    let mut live = run.live.lock().unwrap();
    let key = saved_key()
        .or_else(env_key)
        .ok_or("Add your Anthropic API key in Settings first.")?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runs = data.join("runs");
    fs::create_dir_all(&runs).map_err(|e| e.to_string())?;
    let stamp = now_ms();
    let log = runs.join(format!("{stamp}.jsonl"));
    let tasks = runs.join(format!("{stamp}-trial.json"));
    let contents = serde_json::json!({ "tasks": request.tasks }).to_string();
    fs::write(&tasks, contents).map_err(|e| e.to_string())?;

    let stack = request.stack.to_string();
    let thread = ledger
        .start_thread(&request.label, &request.repo, "", &stack, stamp)
        .map_err(|e| e.to_string())?;
    let entry = ledger
        .start_run(thread, "trial", &log.display().to_string(), stamp)
        .map_err(|e| e.to_string())?;
    let private = private_args(&request.private_files);
    let models = models_args(&request.models);
    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        request.repo,
        "--trial-file".into(),
        tasks.display().to_string(),
        "--stack-json".into(),
        stack,
        "--cap".into(),
        format!("{:.4}", request.cap),
        "--log".into(),
        log.display().to_string(),
    ];
    args.extend(private);
    args.extend(models);
    let command = app.shell().sidecar("shoji-runtime").map_err(|e| e.to_string())?;
    let (events, child) = command
        .args(args)
        .env("SHOJI_API_KEY", key)
        .spawn()
        .map_err(|e| {
            noted(ledger.end_run(entry, "failed"));
            e.to_string()
        })?;
    let id = run.count.fetch_add(1, Ordering::Relaxed) + 1;
    live.insert(id, Live { child, entry, thread });
    watch(app, events, id, entry);
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesRequest {
    repo: String,
    /// The stack, as the runtime's --stack-json takes it. Its scout reads the project.
    stack: serde_json::Value,
    /// Dollars the notes may cost.
    cap: f64,
    /// Patterns for files the scout may not read or list. None keeps the runtime's own.
    private_files: Option<Vec<String>>,
    /// The downloaded model list, as the runtime's --models-json takes it. None keeps the built-in one.
    models: Option<serde_json::Value>,
}

/// Has the scout read the project and write SHOJI.md, the notes Plan reads before every task.
/// Returns None when the project already has notes, since there's nothing to write. Otherwise
/// its events and exit arrive like a thread's, under the returned run number.
#[tauri::command]
fn start_notes(
    app: AppHandle,
    run: State<Run>,
    ledger: State<Ledger>,
    request: NotesRequest,
) -> Result<Option<u64>, String> {
    if Path::new(&request.repo).join("SHOJI.md").exists() {
        return Ok(None);
    }
    let mut live = run.live.lock().unwrap();
    let key = saved_key()
        .or_else(env_key)
        .ok_or("Add your Anthropic API key in Settings first.")?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runs = data.join("runs");
    fs::create_dir_all(&runs).map_err(|e| e.to_string())?;
    let stamp = now_ms();
    let log = runs.join(format!("{stamp}.jsonl"));

    let stack = request.stack.to_string();
    let thread = ledger
        .start_thread("Project notes", &request.repo, "", &stack, stamp)
        .map_err(|e| e.to_string())?;
    let entry = ledger
        .start_run(thread, "notes", &log.display().to_string(), stamp)
        .map_err(|e| e.to_string())?;
    let private = private_args(&request.private_files);
    let models = models_args(&request.models);
    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        request.repo,
        "--notes".into(),
        "--stack-json".into(),
        stack,
        "--cap".into(),
        format!("{:.4}", request.cap),
        "--log".into(),
        log.display().to_string(),
    ];
    args.extend(private);
    args.extend(models);
    let command = app.shell().sidecar("shoji-runtime").map_err(|e| e.to_string())?;
    let (events, child) = command
        .args(args)
        .env("SHOJI_API_KEY", key)
        .spawn()
        .map_err(|e| {
            noted(ledger.end_run(entry, "failed"));
            e.to_string()
        })?;
    let id = run.count.fetch_add(1, Ordering::Relaxed) + 1;
    live.insert(id, Live { child, entry, thread });
    watch(app, events, id, entry);
    Ok(Some(id))
}

/// The person's answer to a running thread's question about a command.
#[tauri::command]
fn answer_ask(run: State<Run>, id: u64, allow: bool) -> Result<(), String> {
    let mut live = run.live.lock().unwrap();
    let going = live.get_mut(&id).ok_or("That thread isn't running.")?;
    going
        .child
        .write(format!("{{\"allow\":{allow}}}\n").as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_run(run: State<Run>, ledger: State<Ledger>, id: u64) -> Result<(), String> {
    if let Some(going) = run.live.lock().unwrap().remove(&id) {
        noted(ledger.end_run(going.entry, "stopped"));
        going.child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs the person's own git in the project. Paths are taken literally, never as patterns.
fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(["--literal-pathspecs", "-c", "core.quotePath=false"])
        .args(args)
        .current_dir(repo);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let out = command.output().map_err(|e| format!("Couldn't run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The branch the project is on. Threads start from a branch, never a detached commit.
fn current_branch(repo: &str) -> Result<String, String> {
    let branch = git(repo, &["branch", "--show-current"])?.trim().to_string();
    if branch.is_empty() {
        Err("The project isn't on a branch. Switch to one, then start the thread again.".into())
    } else {
        Ok(branch)
    }
}

/// Checks the project is still on the thread's branch.
fn on_branch(repo: &str, branch: &str) -> Result<String, String> {
    let current = current_branch(repo)?;
    if current == branch {
        Ok(current)
    } else {
        Err(format!(
            "The project is on {current} now. Switch back to {branch} to carry on this thread."
        ))
    }
}

/// The task's first words in lower case, joined by dashes.
fn slug(task: &str) -> String {
    let mut slug = String::new();
    let words = task
        .lines()
        .next()
        .unwrap_or("")
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty());
    for word in words {
        if !slug.is_empty() && slug.len() + word.len() >= 40 {
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&word.to_ascii_lowercase());
    }
    slug.truncate(40);
    if slug.is_empty() {
        "thread".into()
    } else {
        slug
    }
}

/// Accepts all of the thread's work and commits it on the thread's branch, as the person's
/// own git identity. Shoji never pushes. Returns the commit's short hash.
/// `repo` is the project itself; the commit is made in the thread's own copy when it has one.
#[tauri::command]
async fn commit_thread(
    ledger: State<'_, Ledger>,
    servers: State<'_, Servers>,
    terminals: State<'_, Terminals>,
    repo: String,
    branch: String,
    message: String,
    thread: i64,
) -> Result<String, String> {
    let workdir = ledger.workdir_of(thread).map_err(|e| e.to_string())?;
    let sha = commit(workdir.as_deref().unwrap_or(&repo), &branch, &message)?;
    noted(ledger.commit(thread, &sha, now_ms()));
    // The work is on its branch now, and the copy is put away so the branch can be checked out.
    if let Some(dir) = workdir {
        servers.stop_in(&dir);
        terminals.close_in(&dir);
        worktree::remove(&repo, &dir);
    }
    Ok(sha)
}

/// Pushes a committed thread's branch to the project's remote, when the person presses Push and open PR,
/// and opens the page where they open a pull request for it. Shoji never pushes on its own.
#[tauri::command]
async fn push_thread(app: AppHandle, repo: String, branch: String) -> Result<push::Pushed, String> {
    let pushed = push::push(&repo, &branch)?;
    if let Some(url) = pushed.url.as_deref() {
        #[allow(deprecated)]
        let _ = tauri_plugin_shell::ShellExt::shell(&app).open(url, None);
    }
    Ok(pushed)
}

/// Starts the project's dev server in a thread's copy, with the person's command. Returns its
/// number; its output arrives as `server-output` and its end as `server-exit`.
#[tauri::command]
fn start_server(app: AppHandle, servers: State<Servers>, dir: String, command: String) -> Result<u64, String> {
    servers.start(&app, &dir, &command)
}

#[tauri::command]
fn stop_server(servers: State<Servers>, id: u64) {
    servers.stop(id);
}

/// Opens the person's shell in a thread's copy, at the given size. Returns the terminal's
/// number; what it prints arrives as `terminal-output`, and its end as `terminal-exit`.
#[tauri::command]
fn open_terminal(app: AppHandle, terminals: State<Terminals>, dir: String, cols: u16, rows: u16) -> Result<u64, String> {
    terminals.open(&app, &dir, cols, rows)
}

#[tauri::command]
fn write_terminal(terminals: State<Terminals>, id: u64, data: String) -> Result<(), String> {
    terminals.write(id, &data)
}

#[tauri::command]
fn resize_terminal(terminals: State<Terminals>, id: u64, cols: u16, rows: u16) {
    terminals.resize(id, cols, rows);
}

#[tauri::command]
fn close_terminal(terminals: State<Terminals>, id: u64) {
    terminals.close(id);
}

/// Asks where to save a CSV file, then writes it there. Returns the path, or none if cancelled.
#[tauri::command]
async fn export_csv(app: AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Export receipts")
        .set_file_name(&name)
        .add_filter("CSV", &["csv"])
        .blocking_save_file()
        .and_then(|path| path.into_path().ok())
    else {
        return Ok(None);
    };
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// The person's stack choice and its history, as the app wrote it; none before the first choice.
#[tauri::command]
fn read_stack_lock(app: AppHandle) -> Result<Option<String>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("stack.lock");
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Replaces stack.lock whole, through a temporary file so a crash never leaves half of one.
#[tauri::command]
fn write_stack_lock(app: AppHandle, contents: String) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let partial = data.join("stack.lock.partial");
    fs::write(&partial, contents).map_err(|e| e.to_string())?;
    fs::rename(&partial, data.join("stack.lock")).map_err(|e| e.to_string())
}

/// A run's events as the runtime wrote them, for reopening a past thread. Only runs the ledger
/// knows are read, and only from the app's own runs folder.
#[tauri::command]
async fn run_events(app: AppHandle, ledger: State<'_, Ledger>, run: i64) -> Result<Vec<serde_json::Value>, String> {
    let log = ledger.log_of(run).map_err(|e| e.to_string())?.ok_or("Shoji has no record of that run.")?;
    let runs = app.path().app_data_dir().map_err(|e| e.to_string())?.join("runs");
    read_events(&runs, Path::new(&log))
}

fn read_events(runs: &Path, log: &Path) -> Result<Vec<serde_json::Value>, String> {
    if !log.starts_with(runs) {
        return Err("That run's log isn't in Shoji's runs folder.".into());
    }
    // A log that's gone, such as one removed by hand, just shows nothing.
    let Ok(text) = fs::read_to_string(log) else { return Ok(Vec::new()) };
    Ok(text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect())
}

/// Every thread in the ledger with its runs and calls, newest first, for Receipts.
#[tauri::command]
async fn ledger_threads(ledger: State<'_, Ledger>) -> Result<Vec<ThreadRecord>, String> {
    ledger.threads().map_err(|e| e.to_string())
}

fn commit(repo: &str, branch: &str, message: &str) -> Result<String, String> {
    on_branch(repo, branch)?;
    git(repo, &["add", "--all", "."])?;
    if git(repo, &["diff", "--cached", "--quiet"]).is_ok() {
        return Err("There's nothing to commit. The project matches its last commit.".into());
    }
    git(repo, &["commit", "--quiet", "--cleanup=whitespace", "-m", message]).map_err(|e| {
        if e.contains("user.email") || e.contains("user.name") {
            "Git doesn't know who you are yet. Set user.name and user.email in git, then commit again."
                .to_string()
        } else {
            e
        }
    })?;
    Ok(git(repo, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

fn names(list: &str) -> Vec<String> {
    list.lines().filter(|l| !l.is_empty()).map(str::to_string).collect()
}

#[derive(Debug, Serialize)]
struct ProjectChanges {
    /// Every change against the last commit, as a unified diff.
    diff: String,
    /// Changed files the person has accepted, which git holds as staged.
    accepted: Vec<String>,
}

/// What the project changed since its last commit. New files are marked as intended,
/// so they show in the diff without being staged.
#[tauri::command]
async fn changes(repo: String) -> Result<ProjectChanges, String> {
    read_changes(&repo)
}

fn read_changes(repo: &str) -> Result<ProjectChanges, String> {
    git(repo, &["add", "--all", "--intent-to-add", "."])?;
    let diff = git(repo, &["diff", "HEAD", "--no-color", "--no-ext-diff", "--no-renames"])?;
    let changed = names(&git(repo, &["diff", "HEAD", "--name-only", "--no-renames"])?);
    let unstaged = names(&git(repo, &["diff", "--name-only", "--no-renames"])?);
    let accepted = changed.into_iter().filter(|f| !unstaged.contains(f)).collect();
    Ok(ProjectChanges { diff, accepted })
}

/// Most files the task box offers to mention; a project bigger than this offers the first ones git lists.
const MOST_FILES: usize = 20_000;

/// The project's files, as git sees them: committed or new, leaving out what .gitignore ignores.
/// The task box offers them after an @.
#[tauri::command]
async fn project_files(repo: String) -> Result<Vec<String>, String> {
    list_files(&repo)
}

fn list_files(repo: &str) -> Result<Vec<String>, String> {
    let listed = git(repo, &["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate"])?;
    let mut files = names(&listed);
    files.sort();
    files.truncate(MOST_FILES);
    Ok(files)
}

/// Refuses a path that isn't one of the project's current changes.
fn changed_file(repo: &str, path: &str) -> Result<(), String> {
    let inside = Path::new(path)
        .components()
        .all(|c| matches!(c, Component::Normal(_)));
    let changed = names(&git(repo, &["diff", "HEAD", "--name-only", "--no-renames"])?);
    if inside && changed.iter().any(|f| f == path) {
        Ok(())
    } else {
        Err(format!("{path} isn't one of this project's changes."))
    }
}

/// Keeps a file's changes by staging it, ready for the commit.
#[tauri::command]
async fn accept_file(repo: String, path: String) -> Result<(), String> {
    changed_file(&repo, &path)?;
    git(&repo, &["add", "--", &path]).map(|_| ())
}

/// Largest file the editor opens. Anything bigger isn't a small edit.
const MOST_EDITED: u64 = 1_000_000;

/// One of the thread's changed files, as text, for the person to edit by hand.
#[tauri::command]
async fn read_file(repo: String, path: String) -> Result<String, String> {
    let file = editable(&repo, &path)?;
    String::from_utf8(fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|_| format!("{path} isn't text, so it can't be edited here."))
}

/// Saves the person's own edit to one of the thread's changed files.
#[tauri::command]
async fn write_file(repo: String, path: String, contents: String) -> Result<(), String> {
    let file = editable(&repo, &path)?;
    fs::write(file, contents).map_err(|e| e.to_string())
}

/// A changed file that's still there as a plain file of editable size, never a link elsewhere.
fn editable(repo: &str, path: &str) -> Result<std::path::PathBuf, String> {
    changed_file(repo, path)?;
    let file = Path::new(repo).join(path);
    let meta = fs::symlink_metadata(&file).map_err(|_| format!("{path} was removed, so there's nothing to edit."))?;
    if !meta.file_type().is_file() {
        return Err(format!("{path} isn't a plain file, so it can't be edited here."));
    }
    if meta.len() > MOST_EDITED {
        return Err(format!("{path} is too big to edit here."));
    }
    Ok(file)
}

/// Puts a file back as it was at the last commit. A file the thread created is removed.
#[tauri::command]
async fn revert_file(repo: String, path: String) -> Result<(), String> {
    revert(&repo, &path)
}

fn revert(repo: &str, path: &str) -> Result<(), String> {
    changed_file(repo, path)?;
    if git(repo, &["cat-file", "-e", &format!("HEAD:{path}")]).is_ok() {
        git(repo, &["restore", "--source=HEAD", "--staged", "--worktree", "--", path])?;
    } else {
        git(repo, &["rm", "--cached", "--force", "--quiet", "--", path])?;
        match fs::remove_file(Path::new(repo).join(path)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    shell_path::adopt();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Run::default())
        .manage(Servers::default())
        .manage(Terminals::default())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            fs::create_dir_all(&data)?;
            let path = data.join("shoji.db");
            // A ledger that can't be read is set aside, not lost, so the app still opens.
            let ledger = Ledger::open(&path).or_else(|e| {
                eprintln!("ledger: {e}");
                fs::rename(&path, data.join(format!("shoji-unreadable-{}.db", now_ms())))
                    .map_err(|e| e.to_string())?;
                Ledger::open(&path).map_err(|e| e.to_string())
            })?;
            app.manage(ledger);
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                titlebar::keep_buttons_centred(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_status,
            save_key,
            use_shell_key,
            forget_key,
            pick_project,
            pick_attachments,
            save_attachment,
            start_run,
            start_trial,
            start_notes,
            stop_run,
            answer_ask,
            changes,
            project_files,
            slash::project_commands,
            push_thread,
            accept_file,
            revert_file,
            commit_thread,
            ledger_threads,
            run_events,
            export_csv,
            read_stack_lock,
            write_stack_lock,
            start_server,
            stop_server,
            read_file,
            write_file,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Dev servers are the person's own processes, so they go when Shoji does.
            if let tauri::RunEvent::Exit = event {
                app.state::<Servers>().stop_all();
                app.state::<Terminals>().close_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway repository with two committed files.
    fn repo(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("shoji-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let root = dir.display().to_string();
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        fs::write(dir.join("b.txt"), "two\n").unwrap();
        git(&root, &["init", "-q"]).unwrap();
        git(&root, &["add", "."]).unwrap();
        git(&root, &["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "start"]).unwrap();
        root
    }

    #[test]
    fn passes_private_patterns_and_an_empty_list_as_keeping_nothing() {
        assert!(private_args(&None).is_empty());
        assert_eq!(private_args(&Some(vec![])), vec!["--private="]);
        assert_eq!(
            private_args(&Some(vec![".env".into(), "--help".into()])),
            vec!["--private=.env", "--private=--help"]
        );
    }

    #[test]
    fn lists_committed_and_new_files_but_not_ignored_ones() {
        let root = repo("files");
        let dir = Path::new(&root);
        fs::write(dir.join(".gitignore"), "build/\n").unwrap();
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::write(dir.join("build/out.js"), "").unwrap();
        fs::write(dir.join("new.txt"), "").unwrap();
        let files = list_files(&root).unwrap();
        assert_eq!(files, vec![".gitignore", "a.txt", "b.txt", "new.txt"]);
    }

    #[test]
    fn passes_the_model_list_as_one_joined_flag() {
        assert!(models_args(&None).is_empty());
        let list = serde_json::json!({ "version": 1, "models": {} });
        assert_eq!(models_args(&Some(list)), vec![r#"--models-json={"models":{},"version":1}"#]);
        let servers = serde_json::json!({ "mcpServers": { "docs": { "url": "https://x.example/mcp" } } });
        assert_eq!(mcp_args(&Some(servers)), vec![r#"--mcp-json={"mcpServers":{"docs":{"url":"https://x.example/mcp"}}}"#]);
    }

    #[test]
    fn reads_a_runs_events_only_from_the_runs_folder() {
        let runs = std::env::temp_dir().join(format!("shoji-runs-{}", std::process::id()));
        fs::create_dir_all(&runs).unwrap();
        let log = runs.join("1.jsonl");
        fs::write(&log, "{\"type\":\"tool\"}\nnot json\n{\"type\":\"result\"}\n").unwrap();
        let events = read_events(&runs, &log).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1]["type"], "result");
        assert!(read_events(&runs, &runs.join("gone.jsonl")).unwrap().is_empty());
        assert!(read_events(&runs, Path::new("/etc/passwd")).is_err());
    }

    #[test]
    fn keeps_attachment_names_inside_their_folder() {
        assert_eq!(attachment_name("Screenshot 2026-10-30 at 9.41.png"), "Screenshot-2026-10-30-at-9.41.png");
        assert_eq!(attachment_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(attachment_name("..\\..\\x.png"), "-..-x.png");
        assert_eq!(attachment_name(""), "pasted.png");
    }

    #[test]
    fn lists_changes_and_accepts_one_file() {
        let root = repo("accept");
        fs::write(Path::new(&root).join("a.txt"), "one, changed\n").unwrap();
        fs::write(Path::new(&root).join("new.txt"), "new\n").unwrap();

        let before = read_changes(&root).unwrap();
        assert!(before.diff.contains("+one, changed"));
        assert!(before.diff.contains("+new"));
        assert!(before.accepted.is_empty());

        changed_file(&root, "a.txt").unwrap();
        git(&root, &["add", "--", "a.txt"]).unwrap();
        assert_eq!(read_changes(&root).unwrap().accepted, vec!["a.txt"]);
    }

    #[test]
    fn edits_only_changed_plain_files() {
        let root = repo("edit");
        fs::write(Path::new(&root).join("a.txt"), "changed\n").unwrap();
        let read = |path: &str| tauri::async_runtime::block_on(read_file(root.clone(), path.into()));
        let write =
            |path: &str, text: &str| tauri::async_runtime::block_on(write_file(root.clone(), path.into(), text.into()));
        assert_eq!(read("a.txt").unwrap(), "changed\n");
        write("a.txt", "by hand\n").unwrap();
        assert_eq!(fs::read_to_string(Path::new(&root).join("a.txt")).unwrap(), "by hand\n");
        // Unchanged files and paths outside the project aren't the thread's to edit.
        assert!(read("b.txt").unwrap_err().contains("isn't one of this project's changes"));
        assert!(write("../a.txt", "x").is_err());
        fs::write(Path::new(&root).join("bin.dat"), [0xff, 0xfe, 0x00]).unwrap();
        // Code reads the changes first, which marks new files so they count.
        read_changes(&root).unwrap();
        assert!(read("bin.dat").unwrap_err().contains("isn't text"));
    }

    #[test]
    fn reverts_edited_and_new_files() {
        let root = repo("revert");
        fs::write(Path::new(&root).join("a.txt"), "one, changed\n").unwrap();
        fs::write(Path::new(&root).join("new.txt"), "new\n").unwrap();
        read_changes(&root).unwrap();

        revert(&root, "a.txt").unwrap();
        revert(&root, "new.txt").unwrap();
        assert_eq!(fs::read_to_string(Path::new(&root).join("a.txt")).unwrap(), "one\n");
        assert!(!Path::new(&root).join("new.txt").exists());
        assert_eq!(read_changes(&root).unwrap().diff, "");
    }

    #[test]
    fn names_a_new_branch_after_the_task() {
        assert_eq!(slug("Add a FAQ section to the pricing page"), "add-a-faq-section-to-the-pricing-page");
        assert_eq!(slug("Fix: the café's footer!\nMore detail"), "fix-the-caf-s-footer");
        assert_eq!(slug("…"), "thread");
        assert!(slug(&"word ".repeat(30)).len() <= 40);
    }

    #[test]
    fn commits_the_thread_on_its_branch() {
        let root = repo("commit");
        git(&root, &["config", "user.name", "Bob"]).unwrap();
        git(&root, &["config", "user.email", "bob@example.com"]).unwrap();
        let branch = "shoji/change-a".to_string();
        git(&root, &["switch", "--quiet", "-c", &branch]).unwrap();
        fs::write(Path::new(&root).join("a.txt"), "one, changed\n").unwrap();
        fs::write(Path::new(&root).join("new.txt"), "new\n").unwrap();
        read_changes(&root).unwrap();

        assert!(commit(&root, "other", "x").unwrap_err().contains("Switch back"));
        let sha = commit(&root, &branch, "Change a\n\nShoji-Cost: $0.0100").unwrap();
        assert_eq!(git(&root, &["rev-parse", "--short", "HEAD"]).unwrap().trim(), sha);
        assert_eq!(git(&root, &["log", "-1", "--format=%an %s"]).unwrap().trim(), "Bob Change a");
        assert_eq!(git(&root, &["status", "--porcelain"]).unwrap(), "");
        assert!(commit(&root, &branch, "again").unwrap_err().contains("nothing to commit"));
    }

    #[test]
    fn refuses_files_outside_the_changes() {
        let root = repo("refuse");
        fs::write(Path::new(&root).join("a.txt"), "changed\n").unwrap();
        assert!(revert(&root, "b.txt").is_err());
        assert!(revert(&root, "../a.txt").is_err());
        assert_eq!(fs::read_to_string(Path::new(&root).join("b.txt")).unwrap(), "two\n");
    }
}
