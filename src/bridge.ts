// The app's only way to the Rust side: the keychain, the folder picker and the runtime.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CallRecord, RuntimeEvent } from "../runtime/src/events";
import type { NotesEvent } from "../runtime/src/notes";
import type { Stack } from "../runtime/src/stack";
import type { TrialEvent, TrialTask } from "../runtime/src/trial";

export interface KeyStatus {
  saved: boolean;
  /** A key from SHOJI_API_KEY or ANTHROPIC_API_KEY, which only a shell-launched app sees. */
  fromEnv: boolean;
}

export interface RunRequest {
  repo: string;
  task: string;
  stack: Stack;
  /** Dollars this run may spend. */
  cap: number;
  /** Set for a run that carries on a thread, with the thread, its plan and its branch. */
  changes?: ChangesRequest;
  /** Stop once the plan is written, for the person to build or change it. */
  planOnly?: boolean;
  /** Screenshots and files attached to the thread's task, as paths. */
  attachments?: string[];
}

export interface ChangesRequest {
  /** The thread's id in the ledger. */
  thread: number;
  notes: string;
  plan: string;
  branch: string;
  /** Changes to the work (the default), building an approved plan, or planning again from notes on it. */
  kind?: "changes" | "build" | "replan";
  /** Checks that failed before the thread's first build, which these changes leave alone. */
  failingBefore?: string[];
  /** The failures those checks named then, so a new one inside them still counts. */
  failingTestsBefore?: string[];
}

export interface TrialRequest {
  repo: string;
  /** What the trial tries, in words; the ledger and Receipts name it by this. */
  label: string;
  /** The candidate stack. */
  stack: Stack;
  /** Dollars the whole trial may spend. */
  cap: number;
  tasks: TrialTask[];
}

export interface NotesRequest {
  repo: string;
  /** The stack; its Scout reads the project. */
  stack: Stack;
  /** Dollars the notes may cost. */
  cap: number;
}

export interface StartedRun {
  run: number;
  /** The thread's id in the ledger, which keeps its runs and calls for Receipts. */
  thread: number;
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

/** A thread as the ledger keeps it. Times are milliseconds since 1970. */
export interface LedgerThread {
  id: number;
  task: string;
  repo: string;
  branch: string;
  /** The stack as JSON, or a preset name for threads from before stack.lock. */
  stack: string;
  startedAt: number;
  committed: string | null;
  committedAt: number | null;
  runs: LedgerRun[];
}

export interface LedgerRun {
  id: number;
  kind: "task" | "changes" | "build" | "replan" | "trial" | "notes";
  startedAt: number;
  /** How the run ended; null while it's going. */
  status: "ready" | "needs-work" | "stopped" | "failed" | "planned" | null;
  calls: LedgerCall[];
}

export interface LedgerCall extends Omit<CallRecord, "model"> {
  at: number;
  /** A model id; a ledger can hold models this version no longer lists. */
  model: string;
}

export const bridge = {
  keyStatus: () => invoke<KeyStatus>("key_status"),
  saveKey: (key: string) => invoke<void>("save_key", { key }),
  /** Saves the key the app found in its environment to the keychain. The key never reaches this side. */
  useShellKey: () => invoke<void>("use_shell_key"),
  forgetKey: () => invoke<void>("forget_key"),
  pickProject: () => invoke<string | null>("pick_project"),
  /** Asks for screenshots or files to attach to a task. Empty when the person cancels. */
  pickAttachments: () => invoke<string[]>("pick_attachments"),
  /** Keeps a pasted screenshot as a file and returns its path. */
  saveAttachment: (name: string, bytes: number[]) => invoke<string>("save_attachment", { name, bytes }),
  /** Starts a run. Its number is carried by its events and exit. */
  startRun: (request: RunRequest) => invoke<StartedRun>("start_run", { request }),
  /** Starts a trial and returns its run number, which its events and exit carry. */
  startTrial: (request: TrialRequest) => invoke<number>("start_trial", { request }),
  /** Has Scout write the project's SHOJI.md. Returns its run number, or null if the project has notes already. */
  startNotes: (request: NotesRequest) => invoke<number | null>("start_notes", { request }),
  stopRun: () => invoke<void>("stop_run"),
  changes: (repo: string) => invoke<ProjectChanges>("changes", { repo }),
  /** Keeps a file's changes by staging it. */
  acceptFile: (repo: string, path: string) => invoke<void>("accept_file", { repo, path }),
  /** Puts a file back as it was at the last commit. */
  revertFile: (repo: string, path: string) => invoke<void>("revert_file", { repo, path }),
  /** Commits all of the thread's work on its branch and returns the commit's short hash. */
  commitThread: (repo: string, branch: string, message: string, thread: number) =>
    invoke<string>("commit_thread", { repo, branch, message, thread }),
  /** Every thread in the ledger with its runs and calls, newest first. */
  ledgerThreads: () => invoke<LedgerThread[]>("ledger_threads"),
  /** Asks where to save a CSV file and writes it there. Returns the path, or null if cancelled. */
  exportCsv: (name: string, contents: string) => invoke<string | null>("export_csv", { name, contents }),
  /** stack.lock's contents, or null before anything has been saved. */
  readStackLock: () => invoke<string | null>("read_stack_lock"),
  writeStackLock: (contents: string) => invoke<void>("write_stack_lock", { contents }),
  onEvent: (handler: (run: number, event: RuntimeEvent) => void) =>
    listen<{ run: number; event: RuntimeEvent }>("runtime-event", (e) => handler(e.payload.run, e.payload.event)),
  onTrialEvent: (handler: (run: number, event: TrialEvent) => void) =>
    listen<{ run: number; event: TrialEvent }>("runtime-event", (e) => handler(e.payload.run, e.payload.event)),
  onNotesEvent: (handler: (run: number, event: NotesEvent) => void) =>
    listen<{ run: number; event: NotesEvent }>("runtime-event", (e) => handler(e.payload.run, e.payload.event)),
  onExit: (handler: (exit: RunExit) => void) => listen<RunExit>("runtime-exit", (e) => handler(e.payload)),
};

export type Bridge = typeof bridge;
