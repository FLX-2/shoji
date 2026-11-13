//! Stopping what a run's runtime started.
//!
//! A run is one runtime process, and the runtime starts others: the project's checks, the dev
//! server Build looks at pages through, a headless browser, and the person's MCP servers. Ending
//! only the runtime left those going, with nothing to stop them but the person.
//!
//! The runtime is started in a group of its own (a job object on Windows), and ending that ends
//! most of what it started. On Windows the job holds everything. On macOS and Linux a process
//! can leave the group, as the dev server does so its own tree can be stopped as one, so those
//! are found through their parents here, before the runtime goes and they lose that link.

#[cfg(unix)]
use std::process::Command;

/// One process as the system lists it: its number, its parent's, and its group's.
#[cfg(unix)]
#[derive(Clone, Copy, PartialEq, Debug)]
struct Process {
    pid: u32,
    parent: u32,
    group: u32,
}

/// Reads `ps`'s three columns, skipping any line that isn't three numbers.
#[cfg(unix)]
fn parse(listing: &str) -> Vec<Process> {
    listing
        .lines()
        .filter_map(|line| {
            let mut numbers = line.split_whitespace().map(str::parse::<u32>);
            match (numbers.next()?, numbers.next()?, numbers.next()?) {
                (Ok(pid), Ok(parent), Ok(group)) => Some(Process { pid, parent, group }),
                _ => None,
            }
        })
        .collect()
}

/// Every process on this computer. Empty when `ps` can't be run, which stops nothing extra.
#[cfg(unix)]
fn processes() -> Vec<Process> {
    Command::new("ps")
        .args(["-axo", "pid=,ppid=,pgid="])
        .output()
        .map(|out| parse(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

/// Everything `root` started, and everything those started in turn. A process is found through
/// its parent, so this is read while the parents are still alive.
#[cfg(unix)]
fn started_by(root: u32, all: &[Process]) -> Vec<Process> {
    let mut found: Vec<Process> = Vec::new();
    let mut parents = vec![root];
    while let Some(parent) = parents.pop() {
        for process in all.iter().filter(|p| p.parent == parent && p.pid != root) {
            if !found.iter().any(|f| f.pid == process.pid) {
                found.push(*process);
                parents.push(process.pid);
            }
        }
    }
    found
}

/// Stops everything `root` started, and leaves `root` itself to the caller, who ends it next.
///
/// Each is asked to end, and anything still there two seconds later is ended outright. A group
/// one of them leads is signalled as a group, which reaches what a dev server's shell started.
/// Shoji's own group is never signalled.
#[cfg(unix)]
pub fn stop_started_by(root: u32) {
    let below = started_by(root, &processes());
    if below.is_empty() {
        return;
    }
    let ours = unsafe { libc::getpgrp() } as u32;
    for process in &below {
        unsafe {
            if process.group == process.pid && process.group != ours {
                libc::kill(-(process.pid as i32), libc::SIGTERM);
            }
            libc::kill(process.pid as i32, libc::SIGTERM);
        }
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        // Only what is still the same process: a number can be given to a new one once its owner has gone.
        let now = processes();
        for process in below {
            if now.iter().any(|p| p.pid == process.pid && p.group == process.group) {
                unsafe {
                    libc::kill(process.pid as i32, libc::SIGKILL);
                }
            }
        }
    });
}

/// On Windows the runtime's job object holds everything it started, and ending the runtime ends the job.
#[cfg(not(unix))]
pub fn stop_started_by(_root: u32) {}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    #[test]
    fn reads_the_process_list_and_skips_what_isn_t_one() {
        let listing = "    1     0     1\n  412     1   412\n  PID  PPID  PGID\n  977   412   412\n\n";
        assert_eq!(
            parse(listing),
            vec![
                Process { pid: 1, parent: 0, group: 1 },
                Process { pid: 412, parent: 1, group: 412 },
                Process { pid: 977, parent: 412, group: 412 },
            ]
        );
    }

    #[test]
    fn finds_what_a_process_started_at_any_depth_and_nothing_else() {
        let p = |pid, parent| Process { pid, parent, group: pid };
        // 10 started 11 and 12, 11 started 13. 20 and its child belong to something else.
        let all = [p(1, 0), p(10, 1), p(11, 10), p(12, 10), p(13, 11), p(20, 1), p(21, 20)];
        let mut found: Vec<u32> = started_by(10, &all).iter().map(|p| p.pid).collect();
        found.sort();
        assert_eq!(found, vec![11, 12, 13]);
        assert!(started_by(13, &all).is_empty());
    }

    /// How many sleeps of this length are running. The odd length marks them apart from any other test's.
    fn sleeping(length: &str) -> usize {
        let found = Command::new("pgrep").args(["-f", &format!("^sleep {length}$")]).output().unwrap().stdout;
        String::from_utf8_lossy(&found).lines().count()
    }

    fn wait_for(mut done: impl FnMut() -> bool) {
        let started = Instant::now();
        while !done() && started.elapsed() < Duration::from_secs(8) {
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn stops_what_a_process_started_and_what_that_started() {
        // A shell that starts a second shell, which starts two sleeps: the shape of a check that runs a script.
        let mut child = Command::new("sh")
            .args(["-c", "sh -c 'sleep 3141 & sleep 3141; wait' & sleep 3141; wait"])
            .stdin(Stdio::null())
            .spawn()
            .unwrap();
        wait_for(|| sleeping("3141") == 3);
        assert_eq!(sleeping("3141"), 3);

        stop_started_by(child.id());
        // The caller ends the process itself.
        child.kill().unwrap();
        child.wait().unwrap();
        wait_for(|| sleeping("3141") == 0);
        assert_eq!(sleeping("3141"), 0, "a process the stopped one started is still running");
    }

    /// The dev server's shape: a shell that leads a group of its own, under the runtime. Here it also ignores
    /// being asked to end, so it's ended outright two seconds later. `setsid` is how a shell script leaves its
    /// group, and only Linux is sure to have it.
    #[cfg(target_os = "linux")]
    #[test]
    fn stops_a_group_one_of_them_leads_even_when_it_ignores_being_asked() {
        let mut child = Command::new("sh")
            .args(["-c", "setsid sh -c 'trap \"\" TERM; sleep 2719 & sleep 2719; wait' & wait"])
            .stdin(Stdio::null())
            .spawn()
            .unwrap();
        wait_for(|| sleeping("2719") == 2);
        let below = started_by(child.id(), &processes());
        // The shell under it leads its own group, which the sleeps share.
        assert!(below.iter().any(|p| p.group == p.pid));
        assert_eq!(below.iter().filter(|p| p.group != p.pid).count(), 2);

        stop_started_by(child.id());
        child.kill().unwrap();
        child.wait().unwrap();
        // Asking wasn't enough.
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(sleeping("2719"), 2);
        wait_for(|| sleeping("2719") == 0);
        assert_eq!(sleeping("2719"), 0, "a process that ignored being asked is still running");
    }
}
