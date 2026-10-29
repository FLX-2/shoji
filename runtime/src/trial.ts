import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeEvent, ThreadResult } from "./events";
import { approves, runThread } from "./pipeline";
import { defaultChecks } from "./project";
import type { ModelProvider } from "./provider";
import type { Stack } from "./stack";
import { Workspace } from "./workspace";

/** An accepted task to replay. */
export interface TrialTask {
  task: string;
  /** The commit the task started from. */
  base: string;
  /** What the task cost when it first ran, in dollars. */
  was: number;
}

export interface TrialOutcome extends TrialTask {
  cost: number;
  status: ThreadResult["status"];
  reason?: string;
  /** The task finished and every check passed, or the project has none. */
  checksPassed: boolean;
  approved: boolean;
}

/** What a trial found: each replayed task, and the totals to set against how they first ran. */
export interface Briefing {
  stack: Stack;
  outcomes: TrialOutcome[];
  cost: number;
  was: number;
  /** Tasks never started because the trial's cap ran out. */
  skipped: number;
}

export type TrialEvent =
  | { type: "task"; index: number; total: number; task: string }
  | { type: "runtime"; index: number; event: RuntimeEvent }
  | { type: "outcome"; index: number; outcome: TrialOutcome }
  | { type: "briefing"; briefing: Briefing };

export interface TrialInput {
  /** The person's project. Trials never touch it: each task runs in a scratch copy. */
  root: string;
  tasks: TrialTask[];
  stack: Stack;
  provider: ModelProvider;
  /** Hard spending cap for the whole trial, in dollars. */
  cap: number;
  /** The check commands for a copy; the project's own scripts by default. */
  checks?: (copy: string) => string[];
  emit: (event: TrialEvent) => void;
}

/** Ran to the end, ready or not. Stopped and failed runs say nothing about the candidate's work. */
export const finished = (status: ThreadResult["status"]) => status === "ready" || status === "needs-work";

/** Below this, no task could get past its scout, so the rest are skipped. */
const LEAST_FOR_A_TASK = 0.005;

/**
 * Replays accepted tasks on a candidate stack, each in a scratch copy of the project at the commit
 * it started from, within one cap for the whole trial.
 */
export async function runTrial(input: TrialInput): Promise<Briefing> {
  const { tasks, stack, emit } = input;
  const outcomes: TrialOutcome[] = [];
  let spent = 0;
  let skipped = 0;

  for (const [index, task] of tasks.entries()) {
    const left = input.cap - spent;
    if (left < LEAST_FOR_A_TASK) {
      skipped = tasks.length - index;
      break;
    }
    emit({ type: "task", index, total: tasks.length, task: task.task });
    let outcome: TrialOutcome;
    let copy: string | null = null;
    try {
      copy = scratchCopy(input.root, task.base);
      const result = await runThread({
        task: task.task,
        stack,
        provider: input.provider,
        workspace: new Workspace(copy),
        checks: (input.checks ?? defaultChecks)(copy),
        cap: left,
        emit: (event) => emit({ type: "runtime", index, event }),
      });
      outcome = {
        ...task,
        cost: result.cost,
        status: result.status,
        reason: result.reason,
        checksPassed: finished(result.status) && result.checks.every((c) => c.ok),
        approved: approves(result.review),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome = { ...task, cost: 0, status: "failed", reason, checksPassed: false, approved: false };
    } finally {
      if (copy) removeCopy(copy);
    }
    spent += outcome.cost;
    outcomes.push(outcome);
    emit({ type: "outcome", index, outcome });
    if (outcome.status === "stopped") {
      skipped = tasks.length - index - 1;
      break;
    }
  }

  const briefing: Briefing = {
    stack,
    outcomes,
    cost: spent,
    was: outcomes.reduce((sum, o) => sum + o.was, 0),
    skipped,
  };
  emit({ type: "briefing", briefing });
  return briefing;
}

/**
 * A copy of the project at `base`, made by git in a temporary folder. Objects are shared with the
 * project by hard links, so it's quick, and nothing in the project itself changes. The copy borrows
 * the project's installed packages, so its checks can run.
 */
export function scratchCopy(root: string, base: string): string {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-trial-"));
  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 50_000_000 });
  const cloned = git(root, "clone", "--quiet", "--local", "--no-checkout", ".", copy);
  if (cloned.status !== 0) {
    fs.rmSync(copy, { recursive: true, force: true });
    throw new Error(`Couldn't copy the project: ${cloned.stderr.trim()}`);
  }
  const checkedOut = git(copy, "checkout", "--quiet", "--detach", base);
  if (checkedOut.status !== 0) {
    fs.rmSync(copy, { recursive: true, force: true });
    throw new Error(`The task's starting commit ${base} isn't in the project any more.`);
  }
  const packages = path.join(root, "node_modules");
  if (fs.existsSync(packages)) {
    fs.symlinkSync(packages, path.join(copy, "node_modules"), "junction");
    // A link isn't a folder to git, so a "node_modules/" ignore rule misses it. Keep it out of the diff.
    fs.appendFileSync(path.join(copy, ".git", "info", "exclude"), "\n/node_modules\n");
  }
  return copy;
}

/** Deletes a scratch copy. The link to the project's packages goes first, so nothing follows it. */
export function removeCopy(copy: string) {
  const packages = path.join(copy, "node_modules");
  if (fs.lstatSync(packages, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(packages);
  fs.rmSync(copy, { recursive: true, force: true });
}

/** A briefing in plain words, for the terminal. */
export function describeBriefing(b: Briefing): string {
  const n = b.outcomes.length;
  const share = (count: number) => `${count} of ${n}`;
  const done = b.outcomes.filter((o) => finished(o.status));
  const cost = done.reduce((sum, o) => sum + o.cost, 0);
  const was = done.reduce((sum, o) => sum + o.was, 0);
  const change = was > 0 ? Math.round(((cost - was) / was) * 100) : 0;
  const lines = [
    `Replayed ${n} ${n === 1 ? "task" : "tasks"}${b.skipped ? `; ${b.skipped} skipped when the cap ran out` : ""}. The trial cost $${b.cost.toFixed(4)}.`,
    done.length
      ? `The ${done.length} that finished cost $${cost.toFixed(4)}, against $${was.toFixed(4)} when they first ran (${change <= 0 ? `${-change}% less` : `${change}% more`}).`
      : "No task finished, so there's no cost to compare.",
    `Checks passed on ${share(b.outcomes.filter((o) => o.checksPassed).length)}.`,
    `The review approved ${share(b.outcomes.filter((o) => o.approved).length)}.`,
  ];
  for (const o of b.outcomes) {
    lines.push(
      `  ${o.status.padEnd(10)} $${o.cost.toFixed(4)}  ${o.task.split("\n")[0]}${o.reason ? ` (${o.reason})` : ""}`,
    );
  }
  return lines.join("\n");
}
