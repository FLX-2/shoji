//! Each thread works in its own git worktree, a copy of the project on the thread's branch.
//! Several threads can run at once, and the person's own checkout is never touched. The copy
//! borrows the project's installed packages through links, and gets its own copy of the
//! project's env files, so its checks and dev server run as they would in the project.

use std::fs;
use std::path::{Path, PathBuf};

use super::{git, slug};

/// Folders of installed packages that a thread's copy links to rather than installs again.
const PACKAGES: &[&str] = &["node_modules", ".venv", "venv", "vendor", "bower_components"];

/// Shoji's own notes on the project, which git ignores, so a copy needs them brought across.
const NOTES: &str = "SHOJI.md";

/// The project's commands and skills, which a person often keeps out of git. A copy without them gets the project's.
const AGENT_FOLDERS: &[&str] = &[".claude/commands", ".claude/skills"];

/// Whether an ignored file is one the copy needs: an env file or Shoji's notes.
fn copied(name: &str) -> bool {
    name == ".env" || name.starts_with(".env.") || name == NOTES
}

/// Whether an ignored folder holds installed packages.
fn packages(path: &str) -> bool {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| PACKAGES.contains(&name))
}

/// What git ignores in a checkout, with ignored folders named once with a trailing slash.
fn ignored(dir: &str) -> Result<Vec<String>, String> {
    let listed = git(dir, &["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"])?;
    Ok(listed.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect())
}

/// Makes a copy of the project on a new branch named after the task, under `root`. It starts
/// from the project's last commit, so changes the person hasn't committed stay where they are.
/// Returns the branch and the copy's folder.
pub fn create(repo: &str, root: &Path, task: &str) -> Result<(String, PathBuf), String> {
    if git(repo, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Err("The project has no commits yet. Commit once, then start the thread again.".into());
    }
    let project = Path::new(repo)
        .file_name()
        .and_then(|name| name.to_str())
        .map(slug)
        .unwrap_or_else(|| "project".into());
    let name = slug(task);
    let taken = |n: &str| {
        git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/shoji/{n}")]).is_ok()
            || root.join(&project).join(n).exists()
    };
    let name = std::iter::once(name.clone())
        .chain((2..).map(|n| format!("{name}-{n}")))
        .find(|n| !taken(n))
        .unwrap();
    let branch = format!("shoji/{name}");
    let dir = root.join(&project).join(&name);
    fs::create_dir_all(dir.parent().unwrap()).map_err(|e| e.to_string())?;
    let path = dir.display().to_string();
    git(repo, &["worktree", "add", "--quiet", "-b", &branch, &path, "HEAD"])?;
    if let Err(e) = furnish(repo, &dir) {
        remove(repo, &path);
        let _ = git(repo, &["branch", "--quiet", "-D", &branch]);
        return Err(e);
    }
    Ok((branch, dir))
}

/// Brings back a thread's copy that was put away, such as after its work was committed, so the
/// thread can carry on. A copy that's still there is left as it is.
pub fn restore(repo: &str, dir: &Path, branch: &str) -> Result<(), String> {
    if dir.exists() {
        return Ok(());
    }
    let _ = git(repo, &["worktree", "prune"]);
    let path = dir.display().to_string();
    git(repo, &["worktree", "add", "--quiet", &path, branch]).map_err(|e| {
        if e.contains("already") {
            format!("{branch} is checked out in the project. Switch the project to another branch to carry on this thread.")
        } else {
            e
        }
    })?;
    furnish(repo, dir)
}

/// Links the project's installed packages into the copy, and copies its env files and any commands and skills
/// git doesn't have across.
fn furnish(repo: &str, dir: &Path) -> Result<(), String> {
    let mut linked = Vec::new();
    for path in ignored(repo)? {
        let (path, folder) = match path.strip_suffix('/') {
            Some(path) => (path, true),
            None => (path.as_str(), false),
        };
        let from = Path::new(repo).join(path);
        let to = dir.join(path);
        if to.exists() || fs::symlink_metadata(&to).is_ok() {
            continue;
        }
        if folder && packages(path) {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            link(&from, &to)?;
            linked.push(path.to_string());
        } else if !folder && Path::new(path).file_name().and_then(|n| n.to_str()).is_some_and(copied) {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    for folder in AGENT_FOLDERS {
        let (from, to) = (Path::new(repo).join(folder), dir.join(folder));
        if from.is_dir() && !to.exists() {
            copy_folder(&from, &to)?;
            linked.push(folder.to_string());
        }
    }
    exclude(&dir.display().to_string(), &linked)
}

/// Copies a folder's files and subfolders, leaving out links.
fn copy_folder(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_folder(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// A link to a folder: a symlink, or on Windows a junction, which needs no special rights.
fn link(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(from, to).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(to)
            .arg(from)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("Couldn't link {}: {}", to.display(), String::from_utf8_lossy(&out.stderr).trim()))
        }
    }
}

/// A link isn't a folder to git, so a "node_modules/" ignore rule misses it. The links are listed
/// in the project's own .git/info/exclude, which is never committed or shared.
fn exclude(dir: &str, linked: &[String]) -> Result<(), String> {
    if linked.is_empty() {
        return Ok(());
    }
    let found = git(dir, &["rev-parse", "--git-path", "info/exclude"])?;
    let file = Path::new(dir).join(found.trim());
    let current = fs::read_to_string(&file).unwrap_or_default();
    let have: Vec<&str> = current.lines().collect();
    let missing: Vec<String> =
        linked.iter().map(|p| format!("/{p}")).filter(|line| !have.contains(&line.as_str())).collect();
    if missing.is_empty() {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let gap = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    fs::write(&file, format!("{current}{gap}{}\n", missing.join("\n"))).map_err(|e| e.to_string())
}

/// Puts a thread's copy away once its work is committed, so the branch can be checked out in the
/// project itself. The links go first, so nothing deletes the project's own packages through them.
pub fn remove(repo: &str, dir: &str) {
    if let Ok(paths) = ignored(dir) {
        for path in paths.iter().filter_map(|p| p.strip_suffix('/')).filter(|p| packages(p)) {
            let at = Path::new(dir).join(path);
            if fs::symlink_metadata(&at).is_ok_and(|m| m.file_type().is_symlink()) {
                let _ = fs::remove_file(&at).or_else(|_| fs::remove_dir(&at));
            }
        }
    }
    let _ = git(repo, &["worktree", "remove", "--force", dir]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> (String, PathBuf) {
        let dir = std::env::temp_dir().join(format!("shoji-wt-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let repo = dir.join("app");
        fs::create_dir_all(repo.join("node_modules/left-pad")).unwrap();
        fs::create_dir_all(repo.join("web/node_modules/react")).unwrap();
        fs::write(repo.join("node_modules/left-pad/index.js"), "pad\n").unwrap();
        fs::write(repo.join(".gitignore"), "node_modules/\n.env*\n!.env.example\nbuild/\n").unwrap();
        fs::write(repo.join(".env"), "TOKEN=1\n").unwrap();
        fs::write(repo.join(".env.example"), "TOKEN=\n").unwrap();
        fs::create_dir_all(repo.join("build")).unwrap();
        fs::write(repo.join("build/out.js"), "built\n").unwrap();
        fs::write(repo.join("web/index.html"), "<p>hi</p>\n").unwrap();
        let root = repo.display().to_string();
        for args in [
            &["init", "--quiet", "-b", "main"][..],
            &["-c", "user.email=t@t", "-c", "user.name=t", "add", "."],
            &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet", "-m", "start"],
        ] {
            git(&root, args).unwrap();
        }
        (root, dir.join("worktrees"))
    }

    #[test]
    fn copies_the_project_with_its_packages_linked_and_env_files_copied() {
        let (repo, root) = project("create");
        // Changes the person hasn't committed stay in the project, out of the thread's way.
        fs::write(Path::new(&repo).join("web/index.html"), "<p>mine</p>\n").unwrap();
        let (branch, dir) = create(&repo, &root, "Add a FAQ page").unwrap();
        assert_eq!(branch, "shoji/add-a-faq-page");
        assert_eq!(dir, root.join("app").join("add-a-faq-page"));
        let path = dir.display().to_string();
        assert_eq!(git(&path, &["branch", "--show-current"]).unwrap().trim(), branch);
        // The project's own checkout stays where it was.
        assert_eq!(git(&repo, &["branch", "--show-current"]).unwrap().trim(), "main");
        assert_eq!(fs::read_to_string(dir.join("web/index.html")).unwrap(), "<p>hi</p>\n");
        assert_eq!(fs::read_to_string(Path::new(&repo).join("web/index.html")).unwrap(), "<p>mine</p>\n");

        assert!(fs::symlink_metadata(dir.join("node_modules")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(dir.join("node_modules/left-pad/index.js")).unwrap(), "pad\n");
        assert!(fs::symlink_metadata(dir.join("web/node_modules")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(dir.join(".env")).unwrap(), "TOKEN=1\n");
        // Build output is the copy's own to make.
        assert!(!dir.join("build").exists());
        // Nothing Shoji added shows as a change.
        assert_eq!(git(&path, &["status", "--porcelain"]).unwrap(), "");

        // A second thread with the same task gets its own branch and folder.
        let (second, other) = create(&repo, &root, "Add a FAQ page").unwrap();
        assert_eq!(second, "shoji/add-a-faq-page-2");
        assert_ne!(other, dir);
    }

    #[test]
    fn removes_the_copy_without_touching_the_project_s_packages() {
        let (repo, root) = project("remove");
        let (branch, dir) = create(&repo, &root, "Tidy up").unwrap();
        remove(&repo, &dir.display().to_string());
        assert!(!dir.exists());
        assert!(Path::new(&repo).join("node_modules/left-pad/index.js").exists());
        assert!(Path::new(&repo).join("web/node_modules/react").exists());
        // The branch stays, so the person can check it out.
        git(&repo, &["switch", "--quiet", &branch]).unwrap();
    }

    #[test]
    fn brings_a_put_away_copy_back_on_its_branch() {
        let (repo, root) = project("restore");
        let (branch, dir) = create(&repo, &root, "Tidy up").unwrap();
        let path = dir.display().to_string();
        remove(&repo, &path);
        restore(&repo, &dir, &branch).unwrap();
        assert_eq!(git(&path, &["branch", "--show-current"]).unwrap().trim(), branch);
        assert!(dir.join("node_modules/left-pad/index.js").exists());
        // Once the project itself has the branch checked out, the copy can't come back.
        remove(&repo, &path);
        git(&repo, &["switch", "--quiet", &branch]).unwrap();
        assert!(restore(&repo, &dir, &branch).unwrap_err().contains("checked out in the project"));
    }

    #[test]
    fn brings_commands_and_skills_git_doesn_t_have() {
        let (repo, root) = project("agent");
        let commands = Path::new(&repo).join(".claude/commands/review");
        fs::create_dir_all(&commands).unwrap();
        fs::write(commands.join("pair.md"), "Review $1.\n").unwrap();
        let skill = Path::new(&repo).join(".claude/skills/migrations");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "Add a migration.\n").unwrap();
        let (_, dir) = create(&repo, &root, "Use a command").unwrap();
        assert_eq!(fs::read_to_string(dir.join(".claude/commands/review/pair.md")).unwrap(), "Review $1.\n");
        assert!(dir.join(".claude/skills/migrations/SKILL.md").exists());
        assert_eq!(git(&dir.display().to_string(), &["status", "--porcelain"]).unwrap(), "");
    }

    #[test]
    fn refuses_a_project_with_no_commits() {
        let dir = std::env::temp_dir().join(format!("shoji-wt-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = dir.display().to_string();
        git(&repo, &["init", "--quiet"]).unwrap();
        assert!(create(&repo, &dir.join("worktrees"), "Anything").unwrap_err().contains("no commits"));
    }
}
