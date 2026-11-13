//! Old data: what finished work left in Shoji's own folder that nothing needs any more. The person clears it
//! from Settings. Only Shoji's own folders are touched, and never the ledger, so Receipts keep every cost.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::{git, worktree};

/// How long ago a thread was put away, a trial ran or an image was pasted before what it left counts as old.
pub const OLD_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// What a clear would remove.
#[derive(Default)]
pub struct Old {
    /// Run logs with the plan, trial tasks and page screenshots kept beside them, and pasted images.
    pub files: Vec<PathBuf>,
    /// Copies of projects whose thread's work is committed, as (project, copy). The branch holds the work, and
    /// the copy is made again when the thread is asked a question.
    pub copies: Vec<(String, String)>,
}

/// Bytes under a path. A link counts for nothing and is never followed: a copy links the project's packages.
pub fn size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.file_type().is_symlink() {
        0
    } else if meta.is_dir() {
        fs::read_dir(path).map(|entries| entries.flatten().map(|e| size(&e.path())).sum()).unwrap_or(0)
    } else {
        meta.len()
    }
}

/// What a run left in the runs folder: its log, and the plan, trial tasks and page screenshots kept under the
/// same stamp. A log that isn't one Shoji named, straight in that folder, gives nothing.
fn run_files(runs: &Path, log: &Path) -> Vec<PathBuf> {
    let stamp = log.file_stem().and_then(|s| s.to_str()).filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    let (Some(stamp), true) = (stamp, log.parent() == Some(runs)) else { return Vec::new() };
    [format!("{stamp}.jsonl"), format!("{stamp}-plan.md"), format!("{stamp}-trial.json"), format!("{stamp}-shots")]
        .into_iter()
        .map(|name| runs.join(name))
        .filter(|file| fs::symlink_metadata(file).is_ok())
        .collect()
}

/// Pasted images last written before `before`, in milliseconds since 1970.
fn old_pasted(dir: &Path, before: i64) -> Vec<PathBuf> {
    let old = |meta: &fs::Metadata| {
        let written = meta.modified().ok().and_then(|at| at.duration_since(UNIX_EPOCH).ok());
        meta.is_file() && written.is_some_and(|at| (at.as_millis() as i64) < before)
    };
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries.flatten().filter(|e| e.metadata().is_ok_and(|m| old(&m))).map(|e| e.path()).collect()
}

/// Whether a committed thread's copy can go: it is one of Shoji's own, still there, and holds nothing its branch
/// doesn't. Git's ignored files, such as what a check built, aren't work.
fn spare(worktrees: &Path, dir: &str) -> bool {
    let path = Path::new(dir);
    path.starts_with(worktrees)
        && path != worktrees
        && !path.components().any(|c| matches!(c, Component::ParentDir))
        && path.join(".git").exists()
        && git(dir, &["status", "--porcelain"]).is_ok_and(|changed| changed.trim().is_empty())
}

/// What can be cleared from the app's data folder: the files of the runs whose logs are given, pasted images
/// from before `before`, and those of the given committed threads' copies that hold no work of their own.
pub fn find(data: &Path, logs: &[String], copies: &[(String, String)], before: i64) -> Old {
    let runs = data.join("runs");
    let mut files: Vec<PathBuf> = logs.iter().flat_map(|log| run_files(&runs, Path::new(log))).collect();
    files.sort();
    files.dedup();
    files.extend(old_pasted(&data.join("attachments"), before));
    let worktrees = data.join("worktrees");
    let copies = copies.iter().filter(|(_, dir)| spare(&worktrees, dir)).cloned().collect();
    Old { files, copies }
}

/// How much a clear would free.
pub fn bytes(old: &Old) -> u64 {
    let files: u64 = old.files.iter().map(|file| size(file)).sum();
    let copies: u64 = old.copies.iter().map(|(_, dir)| size(Path::new(dir))).sum();
    files + copies
}

/// Removes it all and returns the bytes that went. `stop` ends whatever is running in a copy before it goes.
pub fn clear(old: Old, stop: impl Fn(&str)) -> u64 {
    let mut freed = 0;
    for file in &old.files {
        let had = size(file);
        // Never through a link: remove_dir_all removes a link itself, not what it points to.
        let gone = if fs::symlink_metadata(file).is_ok_and(|m| m.is_dir()) { fs::remove_dir_all(file) } else { fs::remove_file(file) };
        if gone.is_ok() {
            freed += had;
        }
    }
    for (repo, dir) in &old.copies {
        let had = size(Path::new(dir));
        stop(dir);
        worktree::remove(repo, dir);
        freed += had.saturating_sub(size(Path::new(dir)));
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn data(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shoji-old-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for folder in ["runs", "attachments", "worktrees"] {
            fs::create_dir_all(dir.join(folder)).unwrap();
        }
        dir
    }

    fn now() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
    }

    #[test]
    fn finds_a_runs_log_and_what_was_kept_beside_it_and_nothing_outside_the_runs_folder() {
        let data = data("runs");
        let runs = data.join("runs");
        fs::write(runs.join("100.jsonl"), "{}\n").unwrap();
        fs::write(runs.join("100-plan.md"), "plan").unwrap();
        fs::create_dir_all(runs.join("100-shots")).unwrap();
        fs::write(runs.join("100-shots/before-1.png"), [0u8; 64]).unwrap();
        fs::write(runs.join("200.jsonl"), "{}\n").unwrap();
        fs::write(data.join("shoji.db"), "ledger").unwrap();
        fs::write(runs.join("notes.jsonl"), "not a run's").unwrap();

        let outside = data.join("shoji.db").display().to_string();
        let up = runs.join("../shoji.db").display().to_string();
        let named = runs.join("notes.jsonl").display().to_string();
        let logs = [runs.join("100.jsonl").display().to_string(), outside, up, named];
        let old = find(&data, &logs, &[], now());
        let mut names: Vec<String> = old.files.iter().map(|f| f.file_name().unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["100-plan.md", "100-shots", "100.jsonl"]);
        assert_eq!(bytes(&old), 3 + 4 + 64);

        assert_eq!(clear(old, |_| {}), 3 + 4 + 64);
        assert!(!runs.join("100.jsonl").exists() && !runs.join("100-shots").exists());
        // Another run's log, the ledger and a file Shoji didn't name all stay.
        assert!(runs.join("200.jsonl").exists() && data.join("shoji.db").exists() && runs.join("notes.jsonl").exists());
    }

    #[test]
    fn finds_only_pasted_images_from_before_the_day() {
        let data = data("pasted");
        let pasted = data.join("attachments");
        fs::write(pasted.join("1-old.png"), [0u8; 10]).unwrap();
        fs::write(pasted.join("2-new.png"), [0u8; 20]).unwrap();
        let long_ago = SystemTime::now() - Duration::from_millis(OLD_MS as u64 + 60_000);
        fs::File::options().write(true).open(pasted.join("1-old.png")).unwrap().set_modified(long_ago).unwrap();

        let old = find(&data, &[], &[], now() - OLD_MS);
        assert_eq!(old.files, [pasted.join("1-old.png")]);
        assert_eq!(clear(old, |_| {}), 10);
        assert!(pasted.join("2-new.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn counts_a_link_for_nothing_and_leaves_what_it_points_to() {
        let data = data("link");
        let runs = data.join("runs");
        let kept = data.join("kept");
        fs::create_dir_all(&kept).unwrap();
        fs::write(kept.join("mine.txt"), "mine").unwrap();
        fs::create_dir_all(runs.join("300-shots")).unwrap();
        fs::write(runs.join("300.jsonl"), "{}").unwrap();
        std::os::unix::fs::symlink(&kept, runs.join("300-shots/out")).unwrap();

        let old = find(&data, &[runs.join("300.jsonl").display().to_string()], &[], now());
        assert_eq!(bytes(&old), 2);
        clear(old, |_| {});
        assert!(!runs.join("300-shots").exists());
        assert_eq!(fs::read_to_string(kept.join("mine.txt")).unwrap(), "mine");
    }

    /// A project with one commit and installed packages, and a thread's copy of it under the data folder.
    fn copy(data: &Path) -> (String, String) {
        let repo = data.join("app");
        fs::create_dir_all(repo.join("node_modules/left-pad")).unwrap();
        fs::write(repo.join("node_modules/left-pad/index.js"), "pad\n").unwrap();
        fs::write(repo.join(".gitignore"), "node_modules/\n.env\ndist/\n").unwrap();
        fs::write(repo.join(".env"), "TOKEN=1\n").unwrap();
        fs::write(repo.join("index.html"), "<p>hi</p>\n").unwrap();
        let root = repo.display().to_string();
        for args in [
            &["init", "--quiet", "-b", "main"][..],
            &["-c", "user.email=t@t", "-c", "user.name=t", "add", "."],
            &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet", "-m", "start"],
        ] {
            git(&root, args).unwrap();
        }
        let (_, dir) = worktree::create(&root, &data.join("worktrees"), "Add a FAQ page", None).unwrap();
        (root, dir.display().to_string())
    }

    #[test]
    fn clears_a_committed_threads_copy_and_leaves_the_projects_packages_and_the_branch() {
        let data = data("copy");
        let (repo, dir) = copy(&data);
        // What a check built in the copy is ignored by git, and isn't work.
        fs::create_dir_all(Path::new(&dir).join("dist")).unwrap();
        fs::write(Path::new(&dir).join("dist/out.js"), [0u8; 100]).unwrap();

        let old = find(&data, &[], &[(repo.clone(), dir.clone())], now());
        assert_eq!(old.copies, [(repo.clone(), dir.clone())]);
        assert!(bytes(&old) >= 100);
        let stopped = std::cell::RefCell::new(Vec::new());
        assert!(clear(old, |dir| stopped.borrow_mut().push(dir.to_string())) >= 100);
        assert_eq!(*stopped.borrow(), [dir.clone()]);
        assert!(!Path::new(&dir).exists());
        assert!(Path::new(&repo).join("node_modules/left-pad/index.js").exists());
        assert!(git(&repo, &["rev-parse", "--verify", "--quiet", "refs/heads/shoji/add-a-faq-page"]).is_ok());
        // The thread can still be asked a question: its copy comes back from the branch.
        worktree::restore(&repo, Path::new(&dir), "shoji/add-a-faq-page").unwrap();
        assert!(Path::new(&dir).join("index.html").exists());
    }

    #[test]
    fn keeps_a_copy_that_holds_work_its_branch_doesnt_and_any_folder_that_isnt_shojis() {
        let data = data("work");
        let (repo, dir) = copy(&data);
        fs::write(Path::new(&dir).join("faq.html"), "faq\n").unwrap();
        // The project itself is nobody's copy, and neither is the folder all the copies are in.
        let worktrees = data.join("worktrees").display().to_string();
        let asked = [(repo.clone(), dir.clone()), (repo.clone(), repo.clone()), (repo.clone(), worktrees)];
        let old = find(&data, &[], &asked, now());
        assert!(old.copies.is_empty());
        assert_eq!(clear(old, |_| {}), 0);
        assert!(Path::new(&dir).join("faq.html").exists());
    }
}
