import { act } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import type { Bridge, KeyStatus, LedgerThread, RunExit, RunRequest } from "../bridge";

/** Stands in for the Rust side: records what the app asks for and plays back runtime events. */
export function fakeBridge(key: KeyStatus = { saved: true, fromEnv: false }) {
  /** The project's changes as git would report them; tests set these. */
  const project = { diff: "", accepted: [] as string[] };
  /** What the ledger holds; tests fill it. */
  const ledger: LedgerThread[] = [];
  const onEvent: ((run: number, event: RuntimeEvent) => void)[] = [];
  const onExit: ((exit: RunExit) => void)[] = [];
  const calls = {
    starts: [] as RunRequest[],
    stops: 0,
    forgot: 0,
    accepted: [] as string[],
    reverted: [] as string[],
    commits: [] as { repo: string; branch: string; message: string; thread: number }[],
    exports: [] as { name: string; contents: string }[],
  };
  let runs = 0;

  const bridge: Bridge = {
    keyStatus: async () => key,
    saveKey: async () => {},
    forgetKey: async () => {
      calls.forgot++;
      key = { ...key, saved: false };
    },
    pickProject: async () => "/work/pricing-page",
    startRun: async (request) => {
      calls.starts.push(request);
      return { run: ++runs, thread: request.changes?.thread ?? 1, branch: request.changes?.branch ?? "shoji/thread" };
    },
    stopRun: async () => {
      calls.stops++;
    },
    changes: async () => ({ ...project }),
    ledgerThreads: async () => ledger,
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
    /** Sends events from the latest run. */
    emit: (...events: RuntimeEvent[]) =>
      act(() => events.forEach((event) => onEvent.forEach((h) => h(runs, event)))),
    exit: (code: number | null = 0, error = "") => act(() => onExit.forEach((h) => h({ run: runs, code, error }))),
  };
}
