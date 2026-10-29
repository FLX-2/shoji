import { spawnSync } from "node:child_process";
import type { CheckResult } from "./events";

const TIMEOUT_MS = 5 * 60_000;
const KEEP_CHARS = 4000;

/** Runs one shell command in the project and keeps the end of its output. */
export function runCommand(root: string, command: string): CheckResult {
  const run = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 20_000_000,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error ? `\n${run.error.message}` : ""}`;
  return {
    command,
    ok: run.status === 0,
    output: output.length > KEEP_CHARS ? `…${output.slice(-KEEP_CHARS)}` : output,
  };
}

export function runChecks(root: string, commands: string[]): CheckResult[] {
  return commands.map((command) => runCommand(root, command));
}
