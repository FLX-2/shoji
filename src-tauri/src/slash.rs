//! The commands a person can start a task with, such as `/fix-issue 12`: markdown files in the
//! project's `.claude/commands` and their own `~/.claude/commands`, as Claude Code keeps them. The
//! task box lists them after a /, and the runtime turns one into its text.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    /// What the command takes, such as "<number>", from its `argument-hint`.
    pub hint: String,
}

/// The person's own agent folder, as the runtime finds it.
fn claude_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("SHOJI_CLAUDE_HOME").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|home| PathBuf::from(home).join(".claude"))
}

/// A front matter field: `key: value`, quoted or not, or a folded block of indented lines.
fn field(front: &str, key: &str) -> Option<String> {
    let lines: Vec<&str> = front.lines().collect();
    let at = lines.iter().position(|l| l.strip_prefix(key).is_some_and(|rest| rest.starts_with(':')))?;
    let value = lines[at][key.len() + 1..].trim();
    if matches!(value, ">" | "|" | ">-" | "|-") {
        let block: Vec<&str> = lines[at + 1..]
            .iter()
            .take_while(|l| l.is_empty() || l.starts_with(char::is_whitespace))
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        return Some(block.join(if value.starts_with('>') { " " } else { "\n" }));
    }
    let quoted = value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\'')));
    Some(if quoted { value[1..value.len() - 1].to_string() } else { value.to_string() })
}

/// A command file's name, description and argument hint. Without a description, its first line says what it is.
fn read_command(name: &str, text: &str) -> SlashCommand {
    let text = text.replace("\r\n", "\n");
    let (front, body) = match text.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---")) {
        Some((front, body)) => (front, body.split_once('\n').map_or("", |(_, b)| b)),
        None => ("", text.as_str()),
    };
    let first = body.lines().map(|l| l.trim_start_matches('#').trim()).find(|l| !l.is_empty()).unwrap_or("");
    let description = field(front, "description").filter(|d| !d.is_empty()).unwrap_or_else(|| first.to_string());
    SlashCommand {
        name: name.to_string(),
        description: description.chars().take(200).collect(),
        hint: field(front, "argument-hint").unwrap_or_default(),
    }
}

fn walk(dir: &Path, found: &mut Vec<SlashCommand>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            walk(&path, found);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".md")) {
            if found.iter().any(|c| c.name == name) {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                found.push(read_command(name, &text));
            }
        }
    }
}

/// The project's commands, then the person's own that the project doesn't override, by name.
pub fn list(repo: &str, home: Option<&Path>) -> Vec<SlashCommand> {
    let mut found = Vec::new();
    walk(&Path::new(repo).join(".claude/commands"), &mut found);
    if let Some(home) = home {
        walk(&home.join("commands"), &mut found);
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// The commands the task box offers after a /.
#[tauri::command]
pub async fn project_commands(repo: String) -> Vec<SlashCommand> {
    list(&repo, claude_home().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_project_s_commands_and_the_person_s_own() {
        let dir = std::env::temp_dir().join(format!("shoji-slash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let project = dir.join("app/.claude/commands");
        let home = dir.join("home");
        fs::create_dir_all(project.join("frontend")).unwrap();
        fs::create_dir_all(home.join("commands")).unwrap();
        fs::write(
            project.join("fix-issue.md"),
            "---\ndescription: \"Fix a numbered issue\"\nargument-hint: <number>\n---\nFix #$ARGUMENTS.\n",
        )
        .unwrap();
        fs::write(project.join("frontend/test.md"), "# Run the front end's tests\n\nThen fix them.\n").unwrap();
        fs::write(home.join("commands/fix-issue.md"), "The person's own, which the project's overrides.\n").unwrap();
        fs::write(home.join("commands/tidy.md"), "---\ndescription: >\n  Tidy up\n  the code\n---\nTidy.\n").unwrap();
        fs::write(home.join("commands/notes.txt"), "Not a command.\n").unwrap();

        let listed = list(&dir.join("app").display().to_string(), Some(&home));
        let command = |name: &str, description: &str, hint: &str| SlashCommand {
            name: name.into(),
            description: description.into(),
            hint: hint.into(),
        };
        assert_eq!(
            listed,
            vec![
                command("fix-issue", "Fix a numbered issue", "<number>"),
                command("test", "Run the front end's tests", ""),
                command("tidy", "Tidy up the code", ""),
            ]
        );
        assert!(list(&dir.join("nothing").display().to_string(), None).is_empty());
    }
}
