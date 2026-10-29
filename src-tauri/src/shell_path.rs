//! An app opened from the Dock or a desktop launcher gets a bare PATH, without the folders a
//! person's shell adds for tools like npm, pnpm or bun. A project's checks run those tools, so at
//! launch Shoji asks the person's login shell for its PATH and uses that instead.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Marks where the PATH starts, after anything the shell's startup files print.
const MARK: &str = "__SHOJI_PATH__";
/// A shell that takes longer than this to start is left alone, and the app keeps its PATH.
const WAIT: Duration = Duration::from_secs(3);

/// The PATH the person's login shell sets up, or None if it couldn't be read in time.
pub fn login_path(shell: &str) -> Option<String> {
    let mut child = Command::new(shell)
        // env prints PATH with colons in every shell, fish included.
        .args(["-ilc", &format!("printf '{MARK}'; /usr/bin/env")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < WAIT => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout?.read_to_string(&mut out).ok()?;
    path_from(&out)
}

fn path_from(output: &str) -> Option<String> {
    let env = output.rsplit_once(MARK)?.1;
    let path = env
        .lines()
        .find_map(|line| line.strip_prefix("PATH="))?
        .trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// Puts the login shell's PATH in place for everything Shoji starts. Called first thing at launch,
/// before any other thread exists.
pub fn adopt() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Some(path) = login_path(&shell) {
        // SAFETY: this runs at the start of `run`, before Tauri or anything else starts a thread.
        unsafe { std::env::set_var("PATH", path) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_path_after_whatever_startup_files_print() {
        assert_eq!(
            path_from(
                "PATH=/wrong\nWelcome back!\n__SHOJI_PATH__HOME=/Users/d\nPATH=/opt/homebrew/bin:/usr/bin\n"
            ),
            Some("/opt/homebrew/bin:/usr/bin".into())
        );
        assert_eq!(path_from("PATH=/usr/bin"), None);
        assert_eq!(path_from("__SHOJI_PATH__HOME=/Users/d"), None);
    }

    #[test]
    fn asks_a_real_shell() {
        let path = login_path("/bin/sh").expect("sh starts quickly");
        assert!(
            path.split(':')
                .any(|dir| dir == "/bin" || dir == "/usr/bin")
        );
        assert_eq!(login_path("/no/such/shell"), None);
    }
}
