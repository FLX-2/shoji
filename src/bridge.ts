// The app's only way to the Rust side: the keychain, the folder picker and the runtime.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RuntimeEvent } from "../runtime/src/events";
import type { StackName } from "../runtime/src/stack";

export interface KeyStatus {
  saved: boolean;
  /** A key from SHOJI_API_KEY or ANTHROPIC_API_KEY, which only a shell-launched app sees. */
  fromEnv: boolean;
}

export interface RunRequest {
  repo: string;
  task: string;
  stack: StackName;
  /** Dollars this run may spend. */
  cap: number;
  /** Set for a request for changes, with the work's plan and the thread's branch. */
  changes?: { notes: string; plan: string; branch: string };
}

export interface StartedRun {
  run: number;
  /** The thread's branch: a new one for a task, the same one for changes. */
  branch: string;
}

export interface RunExit {
  run: number;
  code: number | null;
  /** What the runtime wrote to stderr, such as why it couldn't start. */
  error: string;
}

export interface ProjectChanges {
  /** Every change against the project's last commit, as a unified diff. */
  diff: string;
  /** Changed files the person has accepted. Git holds them as staged. */
  accepted: string[];
}

export const bridge = {
  keyStatus: () => invoke<KeyStatus>("key_status"),
  saveKey: (key: string) => invoke<void>("save_key", { key }),
  forgetKey: () => invoke<void>("forget_key"),
  pickProject: () => invoke<string | null>("pick_project"),
  /** Starts a run. Its number is carried by its events and exit. */
  startRun: (request: RunRequest) => invoke<StartedRun>("start_run", { request }),
  stopRun: () => invoke<void>("stop_run"),
  changes: (repo: string) => invoke<ProjectChanges>("changes", { repo }),
  /** Keeps a file's changes by staging it. */
  acceptFile: (repo: string, path: string) => invoke<void>("accept_file", { repo, path }),
  /** Puts a file back as it was at the last commit. */
  revertFile: (repo: string, path: string) => invoke<void>("revert_file", { repo, path }),
  /** Commits all of the thread's work on its branch and returns the commit's short hash. */
  commitThread: (repo: string, branch: string, message: string) =>
    invoke<string>("commit_thread", { repo, branch, message }),
  onEvent: (handler: (run: number, event: RuntimeEvent) => void) =>
    listen<{ run: number; event: RuntimeEvent }>("runtime-event", (e) => handler(e.payload.run, e.payload.event)),
  onExit: (handler: (exit: RunExit) => void) => listen<RunExit>("runtime-exit", (e) => handler(e.payload)),
};

export type Bridge = typeof bridge;
