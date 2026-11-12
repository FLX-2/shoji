//! A terminal in a thread's copy of the project: the person's own shell, in a pseudo-terminal
//! so programs that draw on the screen work too. What the shell prints arrives as
//! `terminal-output`, then one `terminal-exit` when it ends.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

struct Session {
    dir: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Every terminal that's open, by its number.
#[derive(Default)]
pub struct Terminals {
    open: Mutex<HashMap<u64, Session>>,
    count: AtomicU64,
}

#[derive(Clone, Serialize)]
struct Output {
    terminal: u64,
    data: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    terminal: u64,
}

/// The person's own shell: $SHELL on macOS and Linux, PowerShell on Windows.
fn shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        CommandBuilder::new("powershell.exe")
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
        let mut command = CommandBuilder::new(shell);
        // A login shell, so it's set up as it is in the person's own terminal.
        command.arg("-l");
        command
    }
}

/// Splits bytes into the text that's complete and what's left of a character cut in two.
pub fn complete_text(bytes: &[u8]) -> (String, &[u8]) {
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), &[]),
        Err(e) if e.error_len().is_none() => {
            let (done, rest) = bytes.split_at(e.valid_up_to());
            (String::from_utf8_lossy(done).into_owned(), rest)
        }
        Err(_) => (String::from_utf8_lossy(bytes).into_owned(), &[]),
    }
}

impl Terminals {
    /// Opens a shell in `dir` at the given size, and returns the terminal's number.
    pub fn open(&self, app: &AppHandle, dir: &str, cols: u16, rows: u16) -> Result<u64, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut command = shell();
        command.cwd(dir);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        // Shoji's own key is for the runtime, not the person's shell.
        command.env_remove("SHOJI_API_KEY");
        let child = pair.slave.spawn_command(command).map_err(|e| format!("Couldn't start a shell: {e}"))?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let id = self.count.fetch_add(1, Ordering::Relaxed) + 1;
        self.open.lock().unwrap().insert(id, Session { dir: dir.to_string(), master: pair.master, writer, child });

        let app = app.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            let mut carried: Vec<u8> = Vec::new();
            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                carried.extend_from_slice(&buffer[..read]);
                let (data, rest) = complete_text(&carried);
                carried = rest.to_vec();
                if !data.is_empty() {
                    let _ = app.emit("terminal-output", Output { terminal: id, data });
                }
            }
            let ended = app.state::<Terminals>().open.lock().unwrap().remove(&id);
            if let Some(mut session) = ended {
                let _ = session.child.wait();
            }
            let _ = app.emit("terminal-exit", Exit { terminal: id });
        });
        Ok(id)
    }

    /// Passes what the person typed to the shell.
    pub fn write(&self, id: u64, data: &str) -> Result<(), String> {
        let mut open = self.open.lock().unwrap();
        let session = open.get_mut(&id).ok_or("That terminal has closed.")?;
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u64, cols: u16, rows: u16) {
        if let Some(session) = self.open.lock().unwrap().get(&id) {
            let _ = session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
        }
    }

    /// Ends a terminal's shell and whatever it's running.
    pub fn close(&self, id: u64) {
        if let Some(session) = self.open.lock().unwrap().get_mut(&id) {
            let _ = session.child.kill();
        }
    }

    /// Ends the terminals in a folder, as before a thread's copy is put away.
    pub fn close_in(&self, dir: &str) {
        for session in self.open.lock().unwrap().values_mut().filter(|s| s.dir == dir) {
            let _ = session.child.kill();
        }
    }

    pub fn close_all(&self) {
        for session in self.open.lock().unwrap().values_mut() {
            let _ = session.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_character_cut_in_two_for_the_next_read() {
        let bytes = "café".as_bytes();
        let (text, rest) = complete_text(&bytes[..4]);
        assert_eq!((text.as_str(), rest), ("caf", &bytes[3..4]));
        let mut joined = rest.to_vec();
        joined.extend_from_slice(&bytes[4..]);
        assert_eq!(complete_text(&joined), ("é".to_string(), &[][..]));
        // Bytes that are wrong, not just cut short, come through replaced rather than held.
        assert_eq!(complete_text(&[0x61, 0xff, 0x62]).0, "a\u{fffd}b");
    }

    #[cfg(unix)]
    #[test]
    fn runs_a_shell_in_a_pseudo_terminal_in_its_folder() {
        let dir = std::env::temp_dir();
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "pwd; test -t 1 && echo tty"]);
        command.cwd(&dir);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        child.wait().unwrap();
        let mut out = Vec::new();
        let mut buffer = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buffer[..n]);
            if String::from_utf8_lossy(&out).contains("tty") {
                break;
            }
        }
        let printed = String::from_utf8_lossy(&out);
        let first = printed.lines().next().unwrap().trim();
        assert_eq!(std::path::Path::new(first).canonicalize().unwrap(), dir.canonicalize().unwrap());
        assert!(printed.contains("tty"));
    }
}
