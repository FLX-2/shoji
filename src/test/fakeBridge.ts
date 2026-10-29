import { act } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import type { Bridge, KeyStatus, RunExit, RunRequest } from "../bridge";

/** Stands in for the Rust side: records what the app asks for and plays back runtime events. */
export function fakeBridge(key: KeyStatus = { saved: true, fromEnv: false }) {
  /** The project's changes as git would report them; tests set these. */
  const project = { diff: "", accepted: [] as string[] };
  const onEvent: ((run: number, event: RuntimeEvent) => void)[] = [];
  const onExit: ((exit: RunExit) => void)[] = [];
  const calls = { starts: [] as RunRequest[], stops: 0, accepted: [] as string[], reverted: [] as string[] };
  let runs = 0;

  const bridge: Bridge = {
    keyStatus: async () => key,
    saveKey: async () => {},
    forgetKey: async () => {},
    pickProject: async () => "/work/pricing-page",
    startRun: async (request) => {
      calls.starts.push(request);
      return ++runs;
    },
    stopRun: async () => {
      calls.stops++;
    },
    changes: async () => ({ ...project }),
    acceptFile: async (_, path) => {
      calls.accepted.push(path);
      project.accepted.push(path);
    },
    revertFile: async (_, path) => {
      calls.reverted.push(path);
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
    /** Sends events from the latest run. */
    emit: (...events: RuntimeEvent[]) =>
      act(() => events.forEach((event) => onEvent.forEach((h) => h(runs, event)))),
    exit: (code: number | null = 0, error = "") => act(() => onExit.forEach((h) => h({ run: runs, code, error }))),
  };
}
