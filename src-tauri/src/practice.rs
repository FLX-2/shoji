//! A small project bundled with Shoji, made on request so a first task never touches the person's own code.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The practice project's files, by their paths inside it.
const FILES: &[(&str, &str)] = &[
    ("README.md", include_str!("../practice/README.md")),
    ("package.json", include_str!("../practice/package.json")),
    ("src/basket.js", include_str!("../practice/src/basket.js")),
    (
        "test/basket.test.js",
        include_str!("../practice/test/basket.test.js"),
    ),
];

/// The task Home offers first in the practice project.
pub const FIRST_TASK: &str = "Make the failing tests in test/basket.test.js pass.";

/// Runs git in the practice project, signing its one commit as Shoji, since the person's git may have no name yet.
fn git(dir: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("git");
    command
        .args([
            "-c",
            "user.name=Shoji",
            "-c",
            "user.email=practice@shoji.invalid",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let out = command.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Shoji couldn't find git. Install it from git-scm.com, then open Shoji again."
                .to_string()
        } else {
            format!("Couldn't run git: {e}")
        }
    })?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The practice project under `data`, made as a git repository with one commit the first time it's asked for.
/// Asked for again, it's the same folder as the person left it.
pub fn make(data: &Path) -> Result<PathBuf, String> {
    let dir = data.join("practice");
    if dir.join(".git").exists() {
        return Ok(dir);
    }
    for (path, text) in FILES {
        let file = dir.join(path);
        std::fs::create_dir_all(file.parent().unwrap_or(&dir)).map_err(|e| e.to_string())?;
        std::fs::write(&file, text).map_err(|e| e.to_string())?;
    }
    git(&dir, &["init", "-q", "-b", "main"])?;
    git(&dir, &["add", "-A"])?;
    git(
        &dir,
        &["commit", "-q", "-m", "A practice project for Shoji"],
    )?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_a_committed_repository_once_and_keeps_it() {
        let data = std::env::temp_dir().join(format!("shoji-practice-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        let dir = make(&data).unwrap();
        assert!(dir.join("test/basket.test.js").exists());
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&dir)
            .output()
            .unwrap();
        assert!(
            status.stdout.is_empty(),
            "the practice project starts clean"
        );
        std::fs::write(dir.join("notes.txt"), "mine").unwrap();
        assert_eq!(make(&data).unwrap(), dir);
        assert!(
            dir.join("notes.txt").exists(),
            "asking again keeps the person's changes"
        );
        let _ = std::fs::remove_dir_all(&data);
    }
}
