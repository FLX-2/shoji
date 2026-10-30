import { act } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import type { NotesEvent } from "../../runtime/src/notes";
import type { TrialEvent } from "../../runtime/src/trial";
import type { Bridge, KeyStatus, LedgerThread, NotesRequest, RunExit, RunRequest, TrialRequest } from "../bridge";

/** Stands in for the Rust side: records what the app asks for and plays back runtime events. */
export function fakeBridge(key: KeyStatus = { saved: true, fromEnv: false }) {
  /** The project's changes as git would report them; tests set these. */
  const project = { diff: "", accepted: [] as string[], files: [] as string[] };
  /** What the ledger holds; tests fill it. */
  const ledger: LedgerThread[] = [];
  /** stack.lock as the app would find it on disk. */
  const files = { stackLock: null as string | null, hasNotes: false };
  const onEvent: ((run: number, event: RuntimeEvent) => void)[] = [];
  const onTrialEvent: ((run: number, event: TrialEvent) => void)[] = [];
  const onNotesEvent: ((run: number, event: NotesEvent) => void)[] = [];
  const onExit: ((exit: RunExit) => void)[] = [];
  const calls = {
    starts: [] as RunRequest[],
    trials: [] as TrialRequest[],
    notes: [] as NotesRequest[],
    stops: 0,
    forgot: 0,
    savedKeys: [] as string[],
    accepted: [] as string[],
    reverted: [] as string[],
    commits: [] as { repo: string; branch: string; message: string; thread: number }[],
    exports: [] as { name: string; contents: string }[],
    lockWrites: [] as string[],
    pasted: [] as { name: string; bytes: number[] }[],
    answers: [] as boolean[],
  };
  /** What the attach dialog answers with; tests fill it. */
  const picked: string[] = [];
  let runs = 0;

  const bridge: Bridge = {
    keyStatus: async () => key,
    saveKey: async (value) => {
      calls.savedKeys.push(value);
      key = { ...key, saved: true };
    },
    useShellKey: async () => {
      if (!key.fromEnv) throw new Error("No key was found in the shell.");
      calls.savedKeys.push("(from the shell)");
      key = { ...key, saved: true };
    },
    forgetKey: async () => {
      calls.forgot++;
      key = { ...key, saved: false };
    },
    pickProject: async () => "/work/pricing-page",
    pickAttachments: async () => [...picked],
    saveAttachment: async (name, bytes) => {
      calls.pasted.push({ name, bytes });
      return `/data/attachments/${name}`;
    },
    startRun: async (request) => {
      calls.starts.push(request);
      return { run: ++runs, thread: request.changes?.thread ?? 1, branch: request.changes?.branch ?? "shoji/thread" };
    },
    startTrial: async (request) => {
      calls.trials.push(request);
      return ++runs;
    },
    startNotes: async (request) => {
      calls.notes.push(request);
      return files.hasNotes ? null : ++runs;
    },
    answerAsk: async (allow) => {
      calls.answers.push(allow);
    },
    stopRun: async () => {
      calls.stops++;
    },
    changes: async () => ({ diff: project.diff, accepted: project.accepted }),
    projectFiles: async () => [...project.files],
    ledgerThreads: async () => ledger,
    readStackLock: async () => files.stackLock,
    writeStackLock: async (contents) => {
      calls.lockWrites.push(contents);
      files.stackLock = contents;
    },
    exportCsv: async (name, contents) => {
      calls.exports.push({ name, contents });
      return `/Users/bob/Downloads/${name}`;
    },
    acceptFile: async (_, path) => {
      calls.accepted.push(path);
      project.accepted.push(path);
    },
    revertFile: async (_, path) => {
      calls.reverted.push(path);
    },
    commitThread: async (repo, branch, message, thread) => {
      calls.commits.push({ repo, branch, message, thread });
      project.diff = "";
      project.accepted = [];
      return "a1b2c3d";
    },
    onEvent: async (handler) => {
      onEvent.push(handler);
      return () => onEvent.splice(onEvent.indexOf(handler), 1);
    },
    onTrialEvent: async (handler) => {
      onTrialEvent.push(handler);
      return () => onTrialEvent.splice(onTrialEvent.indexOf(handler), 1);
    },
    onNotesEvent: async (handler) => {
      onNotesEvent.push(handler);
      return () => onNotesEvent.splice(onNotesEvent.indexOf(handler), 1);
    },
    onExit: async (handler) => {
      onExit.push(handler);
      return () => onExit.splice(onExit.indexOf(handler), 1);
    },
  };

  return {
    bridge,
    calls,
    project,
    ledger,
    files,
    picked,
    /** Sends events from the latest run. */
    emit: (...events: RuntimeEvent[]) => act(() => events.forEach((event) => onEvent.forEach((h) => h(runs, event)))),
    /** Sends trial events from the latest run. */
    emitTrial: (...events: TrialEvent[]) =>
      act(() => events.forEach((event) => onTrialEvent.forEach((h) => h(runs, event)))),
    /** Sends project notes events from the latest run. */
    emitNotes: (...events: NotesEvent[]) =>
      act(() => events.forEach((event) => onNotesEvent.forEach((h) => h(runs, event)))),
    exit: (code: number | null = 0, error = "") => act(() => onExit.forEach((h) => h({ run: runs, code, error }))),
  };
}
