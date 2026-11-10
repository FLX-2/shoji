//! Projects the person has worked on with Claude Code or Codex on this computer, found from those tools' own
//! session logs, so first-run setup can offer them. Only the folder each session ran in is read; nothing is copied.

use std::cmp::Reverse;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// The most projects setup offers.
const MOST: usize = 6;
/// Lines read from the top of each log to find the folder it ran in.
const LINES: usize = 25;
/// Codex keeps one log per session; only the latest are read.
const CODEX_LOGS: usize = 300;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundProject {
    pub path: String,
    /// The tool it was found in: "Claude Code" or "Codex".
    pub from: &'static str,
    /// When it was last worked on there, in milliseconds since 1970.
    pub at: u64,
}

/// Git projects that still exist, latest first, each once.
pub fn found_in(home: &Path, codex_home: Option<PathBuf>) -> Vec<FoundProject> {
    let mut found: Vec<FoundProject> = Vec::new();
    for log in claude_logs(&home.join(".claude").join("projects")) {
        if let Some(path) = folder_of(&log.0) {
            found.push(FoundProject { path, from: "Claude Code", at: log.1 });
        }
    }
    let codex = codex_home.unwrap_or_else(|| home.join(".codex")).join("sessions");
    let mut logs = Vec::new();
    jsonl_under(&codex, 4, &mut logs);
    logs.sort_by_key(|l| Reverse(l.1));
    for log in logs.into_iter().take(CODEX_LOGS) {
        if let Some(path) = folder_of(&log.0) {
            found.push(FoundProject { path, from: "Codex", at: log.1 });
        }
    }

    found.sort_by_key(|f| Reverse(f.at));
    let mut kept: Vec<FoundProject> = Vec::new();
    for project in found {
        if kept.iter().any(|k| k.path == project.path) || !Path::new(&project.path).join(".git").exists() {
            continue;
        }
        kept.push(project);
        if kept.len() == MOST {
            break;
        }
    }
    kept
}

/// The latest log in each of Claude Code's project folders.
fn claude_logs(dir: &Path) -> Vec<(PathBuf, u64)> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let mut logs = Vec::new();
            jsonl_under(&e.path(), 0, &mut logs);
            logs.into_iter().max_by_key(|l| l.1)
        })
        .collect()
}

/// Every .jsonl file in `dir`, and in its folders down to `depth` more levels, with when each last changed.
fn jsonl_under(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                jsonl_under(&path, depth - 1, out);
            }
        } else if path.extension().is_some_and(|x| x == "jsonl") {
            let at = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            out.push((path, at));
        }
    }
}

/// The folder a session ran in: the first `cwd` in the log's opening lines, at the top or in its `payload`.
fn folder_of(log: &Path) -> Option<String> {
    let file = fs::File::open(log).ok()?;
    BufReader::new(file).lines().take(LINES).map_while(Result::ok).find_map(|line| {
        let value: serde_json::Value = serde_json::from_str(&line).ok()?;
        let cwd = value.get("cwd").or_else(|| value.get("payload").and_then(|p| p.get("cwd")))?;
        cwd.as_str().filter(|s| !s.is_empty()).map(str::to_string)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn finds_git_projects_from_both_tools_latest_first_each_once() {
        let home = std::env::temp_dir().join(format!("shoji-found-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        let project = |name: &str| {
            let dir = home.join("code").join(name);
            fs::create_dir_all(dir.join(".git")).unwrap();
            dir.display().to_string()
        };
        let (axon, site, both) = (project("axon"), project("site"), project("both"));
        let plain = home.join("code").join("plain");
        fs::create_dir_all(&plain).unwrap();
        let line = |cwd: &str| serde_json::json!({ "type": "user", "cwd": cwd }).to_string();
        let meta = |cwd: &str| serde_json::json!({ "type": "session_meta", "payload": { "cwd": cwd } }).to_string();

        write(&home.join(".claude/projects/-code-axon/a.jsonl"), &format!("{{\"type\":\"summary\"}}\n{}\n", line(&axon)));
        write(&home.join(".claude/projects/-code-plain/p.jsonl"), &line(&plain.display().to_string()));
        write(&home.join(".claude/projects/-code-gone/g.jsonl"), &line("/no/such/folder"));
        write(&home.join(".claude/projects/-code-both/b.jsonl"), &line(&both));
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&home.join(".codex/sessions/2026/11/09/rollout-1.jsonl"), &meta(&site));
        std::thread::sleep(std::time::Duration::from_millis(20));
        write(&home.join(".codex/sessions/2026/11/10/rollout-2.jsonl"), &meta(&both));

        let found = found_in(&home, None);
        let paths: Vec<_> = found.iter().map(|f| (f.path.as_str(), f.from)).collect();
        assert_eq!(paths.len(), 3, "{paths:?}");
        assert_eq!(paths[0], (both.as_str(), "Codex"));
        assert!(paths.contains(&(site.as_str(), "Codex")));
        assert!(paths.contains(&(axon.as_str(), "Claude Code")));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn finds_nothing_without_the_tools() {
        assert!(found_in(Path::new("/no/such/home"), None).is_empty());
    }
}
