use std::fs;
use std::path::{Component, Path};
use std::process::Command;
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

#[derive(Serialize)]
struct Started {
    run: u64,
    /// The thread's branch, where its work is committed.
    branch: String,
}

#[derive(Deserialize)]
struct Changes {
    notes: String,
    plan: String,
    /// The thread's branch, which the project must still be on.
    branch: String,
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
fn start_run(app: AppHandle, run: State<Run>, request: RunRequest) -> Result<Started, String> {
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

    let repo = request.repo;
    let (branch, base) = match &request.changes {
        Some(changes) => (on_branch(&repo, &changes.branch)?, None),
        None => {
            let base = current_branch(&repo)?;
            (new_thread_branch(&repo, &request.task)?, Some(base))
        }
    };

    let mut args = vec![
        "--json".to_string(),
        "--repo".into(),
        repo.clone(),
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

    let spawned = app
        .shell()
        .sidecar("shoji-runtime")
        .map_err(|e| e.to_string())
        .and_then(|command| {
            command
                .args(args)
                .env("SHOJI_API_KEY", key)
                .spawn()
                .map_err(|e| e.to_string())
        });
    let (mut events, child) = match spawned {
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
    Ok(Started { run: id, branch })
}

#[tauri::command]
fn stop_run(run: State<Run>) -> Result<(), String> {
    if let Some((_, child)) = run.child.lock().unwrap().take() {
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
async fn commit_thread(repo: String, branch: String, message: String) -> Result<String, String> {
    commit(&repo, &branch, &message)
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
            stop_run,
            changes,
            accept_file,
            revert_file,
            commit_thread
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
