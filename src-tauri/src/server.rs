//! The project's own dev server, started in a thread's copy so Preview shows that thread's work.
//! It runs the command the person gave, in their shell, and its output arrives as
//! `server-output`, then one `server-exit`. Several can run at once, one for each copy.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Every dev server that's going, by its number: its process and the folder it serves.
#[derive(Default)]
pub struct Servers {
    live: Mutex<HashMap<u64, (u32, String)>>,
    count: AtomicU64,
}

#[derive(Clone, Serialize)]
struct Line {
    server: u64,
    line: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    server: u64,
    code: Option<i32>,
}

/// A port nothing on this computer is using now, given to the server as PORT. Servers that read
/// PORT then don't collide when several copies run at once; others, such as Vite, find their own.
fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

/// The person's command, run by their shell in `dir`, in a process group of its own so stopping
/// it stops everything it started.
fn shell(dir: &str, command: &str) -> Command {
    #[cfg(unix)]
    let mut shell = {
        use std::os::unix::process::CommandExt;
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command).process_group(0);
        shell
    };
    #[cfg(windows)]
    let mut shell = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut shell = Command::new("cmd");
        shell.arg("/C").raw_arg(command).creation_flags(CREATE_NO_WINDOW);
        shell
    };
    shell
        .current_dir(dir)
        // Shoji's own key is for the runtime, not the person's project.
        .env_remove("SHOJI_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(port) = free_port() {
        shell.env("PORT", port.to_string());
    }
    shell
}

/// Stops a process and everything it started.
fn kill(pid: u32) {
    // The group shares the shell's number, since it was started as the group's leader.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

/// Passes each line a server prints to the app.
fn forward(app: AppHandle, server: u64, from: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        for line in BufReader::new(from).lines().map_while(Result::ok) {
            let _ = app.emit("server-output", Line { server, line });
        }
    });
}

impl Servers {
    /// Starts the person's dev server command in a thread's copy, and returns its number.
    pub fn start(&self, app: &AppHandle, dir: &str, command: &str) -> Result<u64, String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("Give the command that starts the project's dev server.".into());
        }
        let mut live = self.live.lock().unwrap();
        if live.values().any(|(_, d)| d == dir) {
            return Err("A dev server is already running for this thread.".into());
        }
        let mut child = shell(dir, command).spawn().map_err(|e| format!("Couldn't start {command}: {e}"))?;
        let id = self.count.fetch_add(1, Ordering::Relaxed) + 1;
        live.insert(id, (child.id(), dir.to_string()));
        drop(live);
        forward(app.clone(), id, child.stdout.take().unwrap());
        forward(app.clone(), id, child.stderr.take().unwrap());
        let app = app.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            app.state::<Servers>().live.lock().unwrap().remove(&id);
            let _ = app.emit("server-exit", Exit { server: id, code });
        });
        Ok(id)
    }

    pub fn stop(&self, id: u64) {
        if let Some((pid, _)) = self.live.lock().unwrap().get(&id) {
            kill(*pid);
        }
    }

    /// Stops the servers in a folder, as before a thread's copy is put away.
    pub fn stop_in(&self, dir: &str) {
        for (pid, _) in self.live.lock().unwrap().values().filter(|(_, d)| d == dir) {
            kill(*pid);
        }
    }

    /// Stops every server, as the app quits.
    pub fn stop_all(&self) {
        for (pid, _) in self.live.lock().unwrap().values() {
            kill(*pid);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn runs_the_command_in_its_folder_with_a_free_port() {
        let dir = std::env::temp_dir();
        let out = shell(&dir.display().to_string(), "pwd; echo \"port=$PORT\"; echo oops >&2")
            .output()
            .unwrap();
        let printed = String::from_utf8_lossy(&out.stdout);
        let here = dir.canonicalize().unwrap();
        assert!(printed.lines().next().map(|l| std::path::Path::new(l).canonicalize().unwrap()) == Some(here));
        let port: u16 = printed.lines().nth(1).unwrap().strip_prefix("port=").unwrap().parse().unwrap();
        assert!(port > 0);
        assert_eq!(String::from_utf8_lossy(&out.stderr).trim(), "oops");
    }

    #[test]
    fn stopping_stops_what_the_command_started() {
        let dir = std::env::temp_dir().display().to_string();
        let mut child = shell(&dir, "sleep 30 & sleep 30; wait").spawn().unwrap();
        let started = std::time::Instant::now();
        std::thread::sleep(std::time::Duration::from_millis(200));
        kill(child.id());
        child.wait().unwrap();
        assert!(started.elapsed().as_secs() < 10);
        // Nothing is left in the group, once the background sleep has had a moment to go.
        let left = || Command::new("pgrep").args(["-g", &child.id().to_string()]).output().unwrap().stdout;
        let waited = std::time::Instant::now();
        while !left().is_empty() && waited.elapsed().as_secs() < 3 {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(String::from_utf8_lossy(&left()), "");
    }
}
