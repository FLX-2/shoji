import { spawnSync } from "node:child_process";
import type { CheckResult } from "./events";
import { failingIn } from "./failures";

const TIMEOUT_MS = 5 * 60_000;
const KEEP_CHARS = 4000;

/** The environment for project commands, without the API key: the builder can edit the
 *  scripts these commands run, so they must never see it. */
export function commandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!/^(SHOJI|ANTHROPIC)_API_KEY$/i.test(name)) clean[name] = value;
  }
  return { ...clean, CI: "1", FORCE_COLOR: "0" };
}

/** Runs one shell command in the project and keeps the end of its output. */
export function runCommand(root: string, command: string): CheckResult {
  const run = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    windowsHide: true,
    timeout: TIMEOUT_MS,
    maxBuffer: 20_000_000,
    env: commandEnv(),
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error ? `\n${run.error.message}` : ""}`;
  const ok = run.status === 0;
  // Read from the whole output, since the kept end may not reach the first failures.
  const failing = ok ? [] : failingIn(output);
  const result: CheckResult = {
    command,
    ok,
    output: output.length > KEEP_CHARS ? `…${output.slice(-KEEP_CHARS)}` : output,
    ...(failing.length && { failing }),
  };
  return notFound(run.status, output) ? { ...result, missing: true } : result;
}

/** Shells answer a program they can't find with 127 on macOS and Linux and 9009 on Windows. */
function notFound(status: number | null, output: string): boolean {
  return (
    status === 127 ||
    status === 9009 ||
    (status !== 0 && /command not found|is not recognized as an internal or external command/.test(output))
  );
}

export function runChecks(root: string, commands: string[]): CheckResult[] {
  return commands.map((command) => runCommand(root, command));
}
