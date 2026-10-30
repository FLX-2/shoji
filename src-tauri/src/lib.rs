mod ledger;
#[cfg(unix)]
mod shell_path;
#[cfg(target_os = "macos")]
mod titlebar;

use std::fs;
use std::path::{Component, Path};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use ledger::{Ledger, ThreadRecord};

/// Where the Anthropic key lives in the system keychain.
const KEY_SERVICE: &str = "app.shoji.desktop";
const KEY_ACCOUNT: &str = "anthropic";

/// The running thread's runtime process, its run number and its run in the ledger.
/// One thread runs at a time.
#[derive(Default)]
struct Run {
    child: Mutex<Option<(u64, CommandChild, i64)>>,
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

#[derive(Serialize)]
struct Started {
    run: u64,
    /// The thread's id in the ledger.
    thread: i64,
    /// The thread's branch, where its work is committed.
    branch: String,
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
    /// "changes" to the work (the default), "build" for an approved plan, or "replan" for notes
    /// on the plan.
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
/// its own branch; changes carry on the thread's branch.
#[tauri::command]
fn start_run(
    app: AppHandle,
    run: State<Run>,
    ledger: State<Ledger>,
    request: RunRequest,
) -> Result<Started, String> {
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
    let stamp = now_ms();
    let log = runs.join(format!("{stamp}.jsonl"));

    let repo = request.repo;
    if let Some(changes) = &request.changes {
        if !ledger.has_thread(changes.thread).map_err(|e| e.to_string())? {
            return Err("That thread isn't in the ledger.".into());
        }
    }
    let (branch, base) = match &request.changes {
        Some(changes) => (on_branch(&repo, &changes.branch)?, None),
        None => {
            let base = current_branch(&repo)?;
            (new_thread_branch(&repo, &request.task)?, Some(base))
        }
    };

    let task = request.task.clone();
    let stack = request.stack.to_string();
    let thread = request.changes.as_ref().map(|c| (c.thread, c.kind().to_string()));
    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        repo.clone(),
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
        None => ledger
            .start_thread(&task, &repo, &branch, &stack, stamp)
            .map(|thread| (thread, "task".to_string())),
    }
    .and_then(|(thread, kind)| {
        ledger
            .start_run(thread, &kind, &log.display().to_string(), stamp)
            .map(|entry| (thread, entry))
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
            if let Some(base) = base {
                let _ = git(&repo, &["switch", "--quiet", &base]);
                let _ = git(&repo, &["branch", "--quiet", "-D", &branch]);
            }
            return Err(e);
        }
    };
    let id = run.count.fetch_add(1, Ordering::Relaxed) + 1;
    *slot = Some((id, child, entry));
    watch(app, events, id, entry);
    Ok(Started { run: id, thread, branch })
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
                    let state = app.state::<Run>();
                    let mut slot = state.child.lock().unwrap();
                    if slot.as_ref().is_some_and(|(run, _, _)| *run == id) {
                        slot.take();
                    }
                    drop(slot);
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
    let mut slot = run.child.lock().unwrap();
    if slot.is_some() {
        return Err("Something is already running. Let it finish or stop it first.".into());
    }
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
    *slot = Some((id, child, entry));
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
    let mut slot = run.child.lock().unwrap();
    if slot.is_some() {
        return Err("Something is already running. Let it finish or stop it first.".into());
    }
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
    *slot = Some((id, child, entry));
    watch(app, events, id, entry);
    Ok(Some(id))
}

/// The person's answer to the running thread's question about a command.
#[tauri::command]
fn answer_ask(run: State<Run>, allow: bool) -> Result<(), String> {
    let mut slot = run.child.lock().unwrap();
    let (_, child, _) = slot.as_mut().ok_or("No thread is running.")?;
    child
        .write(format!("{{\"allow\":{allow}}}\n").as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_run(run: State<Run>, ledger: State<Ledger>) -> Result<(), String> {
    if let Some((_, child, entry)) = run.child.lock().unwrap().take() {
        noted(ledger.end_run(entry, "stopped"));
        child.kill().map_err(|e| e.to_string())?;
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

/// Moves a clean project onto a new branch named after the task, such as `shoji/add-a-faq`.
fn new_thread_branch(repo: &str, task: &str) -> Result<String, String> {
    current_branch(repo)?;
    if !git(repo, &["status", "--porcelain"])?.trim().is_empty() {
        return Err(
            "The project has uncommitted changes. Commit or stash them, then start the thread again."
                .into(),
        );
    }
    let name = format!("shoji/{}", slug(task));
    let taken = |branch: &str| {
        git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")]).is_ok()
    };
    let branch = std::iter::once(name.clone())
        .chain((2..).map(|n| format!("{name}-{n}")))
        .find(|b| !taken(b))
        .unwrap();
    git(repo, &["switch", "--quiet", "-c", &branch])?;
    Ok(branch)
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
#[tauri::command]
async fn commit_thread(
    ledger: State<'_, Ledger>,
    repo: String,
    branch: String,
    message: String,
    thread: i64,
) -> Result<String, String> {
    let sha = commit(&repo, &branch, &message)?;
    noted(ledger.commit(thread, &sha, now_ms()));
    Ok(sha)
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
            accept_file,
            revert_file,
            commit_thread,
            ledger_threads,
            export_csv,
            read_stack_lock,
            write_stack_lock
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    fn passes_the_model_list_as_one_joined_flag() {
        assert!(models_args(&None).is_empty());
        let list = serde_json::json!({ "version": 1, "models": {} });
        assert_eq!(models_args(&Some(list)), vec![r#"--models-json={"models":{},"version":1}"#]);
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

        let root = repo("branch");
        let start = current_branch(&root).unwrap();
        assert_eq!(new_thread_branch(&root, "Add a FAQ").unwrap(), "shoji/add-a-faq");
        git(&root, &["switch", "--quiet", &start]).unwrap();
        assert_eq!(new_thread_branch(&root, "Add a FAQ").unwrap(), "shoji/add-a-faq-2");
    }

    #[test]
    fn starts_only_on_a_clean_project() {
        let root = repo("dirty");
        fs::write(Path::new(&root).join("a.txt"), "changed\n").unwrap();
        assert!(new_thread_branch(&root, "Task").unwrap_err().contains("uncommitted"));
        fs::write(Path::new(&root).join("a.txt"), "one\n").unwrap();
        fs::write(Path::new(&root).join("new.txt"), "new\n").unwrap();
        assert!(new_thread_branch(&root, "Task").is_err());
    }

    #[test]
    fn commits_the_thread_on_its_branch() {
        let root = repo("commit");
        git(&root, &["config", "user.name", "Bob"]).unwrap();
        git(&root, &["config", "user.email", "bob@example.com"]).unwrap();
        let branch = new_thread_branch(&root, "Change a").unwrap();
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
