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
  changes?: { notes: string; plan: string };
}

export interface RunExit {
  run: number;
  code: number | null;
  /** What the runtime wrote to stderr, such as why it couldn't start. */
  error: string;
}

export const bridge = {
  keyStatus: () => invoke<KeyStatus>("key_status"),
  saveKey: (key: string) => invoke<void>("save_key", { key }),
  forgetKey: () => invoke<void>("forget_key"),
  pickProject: () => invoke<string | null>("pick_project"),
  /** Starts a run and returns its number, which its events and exit carry. */
  startRun: (request: RunRequest) => invoke<number>("start_run", { request }),
  stopRun: () => invoke<void>("stop_run"),
  onEvent: (handler: (run: number, event: RuntimeEvent) => void) =>
    listen<{ run: number; event: RuntimeEvent }>("runtime-event", (e) => handler(e.payload.run, e.payload.event)),
  onExit: (handler: (exit: RunExit) => void) => listen<RunExit>("runtime-exit", (e) => handler(e.payload)),
};

export type Bridge = typeof bridge;
