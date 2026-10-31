// The app's only way to the Rust side: the keychain, the folder picker and the runtime.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CallRecord, RuntimeEvent } from "../runtime/src/events";
import type { McpServer } from "../runtime/src/mcpConfig";
import type { Catalog } from "../runtime/src/models";
import type { NotesEvent } from "../runtime/src/notes";
import type { Stack } from "../runtime/src/stack";
import type { TrialEvent, TrialTask } from "../runtime/src/trial";
import type { SlashCommand } from "./shell/mention";

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
  /** Commands beyond the checks that may run without asking. */
  allowedCommands?: string[];
  /** Patterns, as in .gitignore, for files no role may read, change or list. */
  privateFiles?: string[];
  /** The downloaded model list, when there is one, with version 1 as the runtime reads it. */
  models?: Catalog & { version: 1 };
  /** The person's MCP servers, as the runtime's --mcp-json reads them. */
  mcpServers?: { mcpServers: Record<string, Omit<McpServer, "name">> };
  /** The project's dev command, when Build may start it to look at pages. */
  devCommand?: string;
  /** What the person asked for, as the thread shows it, kept so a reopened thread shows it again. */
  ask?: string;
}

export interface ChangesRequest {
  /** The thread's id in the ledger. */
  thread: number;
  notes: string;
  plan: string;
  branch: string;
  /** Changes to the work (the default), building an approved plan, or planning again from notes on it. */
  kind?: "changes" | "build" | "replan" | "question";
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
  /** Patterns, as in .gitignore, for files no role may read, change or list. */
  privateFiles?: string[];
  /** The downloaded model list, when there is one, with version 1 as the runtime reads it. */
  models?: Catalog & { version: 1 };
}

export interface NotesRequest {
  repo: string;
  /** The stack; its Scout reads the project. */
  stack: Stack;
  /** Dollars the notes may cost. */
  cap: number;
  /** Patterns, as in .gitignore, for files no role may read, change or list. */
  privateFiles?: string[];
  /** The downloaded model list, when there is one, with version 1 as the runtime reads it. */
  models?: Catalog & { version: 1 };
}

/** What every run, trial and notes run carries from the app's settings as they are when it starts. */
export interface Carried {
  privateFiles: string[];
  models?: Catalog;
  /** The person's MCP servers, for a thread's runs only. */
  mcpServers?: McpServer[];
  /** The dev command Build may start in a project to look at its pages, or "" when it doesn't look. */
  devCommandFor?: (repo: string) => string;
}

/** Servers in the shape the runtime's --mcp-json reads. */
function serversJson(servers: McpServer[]) {
  return { mcpServers: Object.fromEntries(servers.map(({ name, ...server }) => [name, server])) };
}

/** The bridge, with the person's private files and the model list added to everything that starts the runtime. */
export function carrying(bridge: Bridge, carried: () => Carried): Bridge {
  const add = <T extends object>(request: T) => {
    const { privateFiles, models } = carried();
    return { ...request, privateFiles, ...(models && { models: { version: 1 as const, ...models } }) };
  };
  return {
    ...bridge,
    startRun: (request) => {
      const { mcpServers, devCommandFor } = carried();
      const devCommand = devCommandFor?.(request.repo);
      return bridge.startRun({
        ...add(request),
        ...(mcpServers?.length && { mcpServers: serversJson(mcpServers) }),
        ...(devCommand && { devCommand }),
      });
    },
    startTrial: (request) => bridge.startTrial(add(request)),
    startNotes: (request) => bridge.startNotes(add(request)),
  };
}

export interface Pushed {
  /** The remote the branch went to, such as "origin". */
  remote: string;
  /** The page that opens a pull request for it, which Shoji opened; null when the host isn't one Shoji knows. */
  url: string | null;
}

export interface StartedRun {
  run: number;
  /** The thread's id in the ledger, which keeps its runs and calls for Receipts. */
  thread: number;
  /** The thread's branch: a new one for a task, the same one for changes. */
  branch: string;
  /** The thread's own copy of the project, where its work happens; null for an older thread that works in
   *  the project itself. */
  workdir: string | null;
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
  /** The thread's own copy of the project; missing or null for threads from before each had one. */
  workdir?: string | null;
  /** The stack as JSON, or a preset name for threads from before stack.lock. */
  stack: string;
  startedAt: number;
  committed: string | null;
  committedAt: number | null;
  /** The person's name for the thread, or the one Scout gave its task; missing or null until there is one. */
  title?: string | null;
  pinned?: boolean;
  /** When the person put the thread away. */
  archivedAt?: number | null;
  /** When the person threw the thread's work away: its copy and branch are gone. */
  discardedAt?: number | null;
  runs: LedgerRun[];
}

export interface LedgerRun {
  id: number;
  kind: "task" | "changes" | "build" | "replan" | "question" | "trial" | "notes";
  startedAt: number;
  /** How the run ended; null while it's going. */
  status: "ready" | "needs-work" | "stopped" | "failed" | "planned" | "answered" | null;
  /** What the person asked for in the run; missing for runs from before it was kept. */
  ask?: string | null;
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
  stopRun: (run: number) => invoke<void>("stop_run", { id: run }),
  /** Answers the running thread's question about a command. */
  answerAsk: (run: number, allow: boolean) => invoke<void>("answer_ask", { id: run, allow }),
  changes: (repo: string) => invoke<ProjectChanges>("changes", { repo }),
  /** The project's files, as git sees them, for mentioning with @ in the task. */
  projectFiles: (repo: string) => invoke<string[]>("project_files", { repo }),
  /** The project's commands and the person's own, which a task can start with after a /. */
  projectCommands: (repo: string) => invoke<SlashCommand[]>("project_commands", { repo }),
  /** Keeps a file's changes by staging it. */
  acceptFile: (repo: string, path: string) => invoke<void>("accept_file", { repo, path }),
  /** Puts a file back as it was at the last commit. */
  revertFile: (repo: string, path: string) => invoke<void>("revert_file", { repo, path }),
  /** Commits all of the thread's work on its branch and returns the commit's short hash. */
  commitThread: (repo: string, branch: string, message: string, thread: number) =>
    invoke<string>("commit_thread", { repo, branch, message, thread }),
  /** Pushes a committed thread's branch to the project's remote and opens the page for a pull request. Only the
   *  person's button calls it. */
  pushThread: (repo: string, branch: string) => invoke<Pushed>("push_thread", { repo, branch }),
  /** Names a thread; an empty name gives it back Scout's title or its task. */
  renameThread: (thread: number, title: string) => invoke<void>("rename_thread", { thread, title }),
  pinThread: (thread: number, pinned: boolean) => invoke<void>("pin_thread", { thread, pinned }),
  /** Puts a thread away or brings it back. Its work and costs stay. */
  archiveThread: (thread: number, archived: boolean) => invoke<void>("archive_thread", { thread, archived }),
  /** Throws away an uncommitted thread's own copy of the project and its branch. */
  discardThread: (thread: number) => invoke<void>("discard_thread", { thread }),
  /** Shows a folder in the system's file manager. */
  revealFolder: (path: string) => invoke<void>("reveal_folder", { path }),
  /** A run's events as the runtime wrote them, for reopening a past thread. */
  runEvents: (run: number) => invoke<RuntimeEvent[]>("run_events", { run }),
  /** A screenshot a run saved of a page before or after its work, as a data URL the page may show. */
  readShot: async (path: string) => {
    const bytes = await invoke<ArrayBuffer>("read_shot", { path });
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([bytes], { type: "image/png" }));
    });
  },
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
  /** One of the thread's changed files, as text, for the person to edit by hand. */
  readFile: (repo: string, path: string) => invoke<string>("read_file", { repo, path }),
  /** Saves the person's own edit to one of the thread's changed files. */
  writeFile: (repo: string, path: string, contents: string) => invoke<void>("write_file", { repo, path, contents }),
  /** Opens the person's shell in a folder at a size in characters, and returns the terminal's number. */
  openTerminal: (dir: string, cols: number, rows: number) => invoke<number>("open_terminal", { dir, cols, rows }),
  writeTerminal: (terminal: number, data: string) => invoke<void>("write_terminal", { id: terminal, data }),
  resizeTerminal: (terminal: number, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { id: terminal, cols, rows }),
  /** Ends a terminal's shell. Its end arrives through onTerminalExit. */
  closeTerminal: (terminal: number) => invoke<void>("close_terminal", { id: terminal }),
  onTerminalOutput: (handler: (terminal: number, data: string) => void) =>
    listen<{ terminal: number; data: string }>("terminal-output", (e) => handler(e.payload.terminal, e.payload.data)),
  onTerminalExit: (handler: (terminal: number) => void) =>
    listen<{ terminal: number }>("terminal-exit", (e) => handler(e.payload.terminal)),
  /** Starts the project's dev server in a folder with the person's command, and returns its number. */
  startServer: (dir: string, command: string) => invoke<number>("start_server", { dir, command }),
  /** Stops a dev server and everything it started. Its end arrives through onServerExit. */
  stopServer: (server: number) => invoke<void>("stop_server", { id: server }),
  onServerOutput: (handler: (server: number, line: string) => void) =>
    listen<{ server: number; line: string }>("server-output", (e) => handler(e.payload.server, e.payload.line)),
  onServerExit: (handler: (server: number, code: number | null) => void) =>
    listen<{ server: number; code: number | null }>("server-exit", (e) => handler(e.payload.server, e.payload.code)),
};

export type Bridge = typeof bridge;
