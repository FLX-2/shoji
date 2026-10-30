import fs from "node:fs";
import path from "node:path";
import { MAX_TOKENS, OUT_OF_TURNS, runAgent, textOf } from "./agent";
import { type Attachments, withAttachments } from "./attachments";
import { runChecks } from "./commands";
import type { CheckResult, Emit, ThreadResult } from "./events";
import { diffOf } from "./git";
import { BudgetExceeded, Meter, RefusedError } from "./meter";
import * as prompts from "./prompts";
import type { ModelProvider } from "./provider";
import { ROLES, type Role, type Seat, type Stack } from "./stack";
import { COMMAND_TOOLS, READ_TOOLS, WRITE_TOOLS } from "./tools";
import type { Workspace } from "./workspace";

export interface ThreadInput {
  task: string;
  stack: Stack;
  provider: ModelProvider;
  workspace: Workspace;
  /** Commands that must pass for the work to count as done, such as "pnpm test". */
  checks: string[];
  /** Hard spending cap for the thread, in dollars. */
  cap: number;
  emit: Emit;
  /**
   * Set when the person asks for changes to finished work. The thread skips scout and plan,
   * and builds the changes on top of the work already in the project.
   */
  changes?: { plan: string; notes: string };
  /** Stop once the plan is written, so the person can build it or ask for a different one. */
  planOnly?: boolean;
  /** A plan the person approved: the thread skips scout and plan and builds it. */
  approved?: string;
  /** The person's notes on an earlier plan, which the planner writes a new one from. */
  replan?: { plan: string; notes: string };
  /** Checks that failed before the thread's first build. A changes run can't see the project as it
   *  was, so it's told. */
  failingBefore?: string[];
  /** The failures those checks named then. */
  failingTestsBefore?: string[];
  /** Screenshots and files the person attached to the task. Every role sees them. */
  attachments?: Attachments;
}


const MAX_FILES_CHARS = 60_000;

/**
 * Runs one thread: scout, plan, build, check, review. A build whose checks fail gets one
 * more try on the same model, then moves up to the plan model, as the MVP spec describes.
 * With `changes`, it runs again from the build on the person's notes.
 */
export async function runThread(input: ThreadInput): Promise<ThreadResult> {
  const { task, stack, workspace, checks, emit, changes, approved, replan } = input;
  const meter = new Meter(input.provider, emit, input.cap);
  const state = { plan: "", review: "", checks: [] as CheckResult[], escalated: false };

  const step = async (name: string, role: Role, seat: Seat, work: () => Promise<string>) => {
    emit({ type: "step", step: name, role, model: seat.model, status: "running" });
    const output = await work();
    emit({ type: "step", step: name, role, model: seat.model, status: "done", output });
    return output;
  };
  const agent = (name: string, role: Role, seat: Seat, system: string, prompt: string, tools: typeof READ_TOOLS) =>
    step(name, role, seat, () =>
      runAgent({
        meter,
        workspace,
        allowedCommands: checks,
        role,
        step: name,
        seat,
        system,
        prompt: withAttachments(prompt, input.attachments),
        tools,
        onTool: (tool, input) =>
          emit({ type: "tool", step: name, tool, target: input.path ?? input.pattern ?? input.command ?? "" }),
      }),
    );
  // Checks that already fail before Shoji changes anything aren't this thread's to fix, unless
  // they name a failure that wasn't there before: a test the change broke inside a failing suite.
  let failingBefore = new Set(input.failingBefore ?? []);
  let testsBefore = new Set(input.failingTestsBefore ?? []);
  const check = (name: string) => {
    state.checks = runChecks(workspace.root, checks).map((c) => {
      if (c.ok || !failingBefore.has(c.command)) return c;
      const fresh = testsBefore.size ? (c.failing ?? []).filter((f) => !testsBefore.has(f)) : [];
      return fresh.length ? { ...c, newFailures: fresh } : { ...c, failedBefore: true };
    });
    emit({ type: "checks", step: name, results: state.checks });
    return state.checks.every((c) => c.ok || c.failedBefore);
  };
  const builderTools = [...READ_TOOLS, ...WRITE_TOOLS, ...(checks.length ? COMMAND_TOOLS : [])];

  try {
    state.plan = changes ? changes.plan : (approved ?? (await planFor()));
    if (input.planOnly) return finish("planned");
    if (!changes) {
      const before = runChecks(workspace.root, checks).filter((c) => !c.ok && !c.missing);
      failingBefore = new Set(before.map((c) => c.command));
      testsBefore = new Set(before.flatMap((c) => c.failing ?? []));
    }
    const commandsNote = checks.length
      ? `\n\nCheck commands you can run: ${checks.join(", ")}${
          failingBefore.size
            ? `\n\nThese checks already failed before any change, so leave their failures alone unless the task is about them: ${[...failingBefore].join(", ")}`
            : ""
        }`
      : "";
    const asked = changes ? `\n\nThe work so far is already in the project. The person asked for these changes:\n${changes.notes}` : "";
    const buildPrompt = `Task: ${task}\n\nPlan:\n${state.plan}${commandsNote}${asked}`;
    const buildStep = changes ? "changes" : "build";
    await agent(buildStep, "build", stack.build, prompts.BUILD, buildPrompt, builderTools);

    // Even when a review asks, an old failure stays out of a fix round, or the round spends itself there.
    const leaveOld = failingBefore.size
      ? `\n\nLeave the failures ${[...failingBefore].join(" and ")} already had before any change, even if the notes above mention them, unless the task itself is about them.`
      : "";
    const fix = (name: string, seat: Seat, notes: string) =>
      agent(
        name,
        "build",
        seat,
        prompts.BUILD,
        `${buildPrompt}\n\nA first attempt is already in the project. Fix what's wrong:\n${notes}${leaveOld}`,
        builderTools,
      );
    const failures = () =>
      state.checks
        .filter((c) => !c.ok && !c.failedBefore)
        .map((c) =>
          c.newFailures
            ? `${c.command} already failed before any change, but these failures are new:\n${c.newFailures.join("\n")}\n\n${c.output}`
            : `${c.command} failed:\n${c.output}`,
        )
        .join("\n\n");

    let fixRounds = 0;
    let seat = stack.build;
    let passing = check(buildStep);
    // A check whose program isn't on this computer fails whatever the code says, so fixing can't help.
    const missing = state.checks.filter((c) => c.missing).map((c) => c.command);
    if (!passing && !missing.length) {
      await fix("fix-1", seat, failures());
      fixRounds++;
      passing = check("fix-1");
    }
    if (!passing && !missing.length && stack.plan.model !== seat.model) {
      emit({ type: "escalate", step: "fix-2", from: seat.model, to: stack.plan.model, reason: "Checks failed twice." });
      seat = stack.plan;
      state.escalated = true;
      await fix("fix-2", seat, failures());
      fixRounds++;
      passing = check("fix-2");
    }

    const review = () =>
      step("review", "review", stack.review, async () =>
        textOf(
          await meter.send("review", "review", {
            model: stack.review.model,
            effort: stack.review.effort,
            system: prompts.REVIEW,
            messages: [
              {
                role: "user",
                content: withAttachments(reviewPrompt(task + asked, diffOf(workspace.root), state.checks), input.attachments),
              },
            ],
            maxTokens: MAX_TOKENS,
          }),
        ),
      );

    state.review = await review();
    if (!approves(state.review) && fixRounds < 2) {
      const fixed = await fix(`fix-${fixRounds + 1}`, seat, state.review);
      passing = check(`fix-${fixRounds + 1}`);
      // Half-done work would only draw the same notes again, so stop and say where it got to.
      if (fixed === OUT_OF_TURNS)
        return finish(
          "needs-work",
          "The fix ran out of turns before it finished, so Shoji stopped instead of reviewing half-done work. The review's notes above say what it was working on, and Fix it picks it up from there.",
        );
      state.review = await review();
    }

    if (missing.length) {
      const which = missing.length === 1 ? "its program isn't" : "their programs aren't";
      return finish(
        "needs-work",
        `Shoji couldn't run ${missing.join(" or ")}: ${which} on this computer, so it didn't try to fix the checks. The review judged the change without them.`,
      );
    }
    const status = passing && approves(state.review) ? "ready" : "needs-work";
    const old = state.checks.filter((c) => c.failedBefore).map((c) => c.command);
    if (old.length) {
      const was = old.length === 1 ? "was already failing" : "were already failing";
      return finish(
        status,
        `${old.join(" and ")} ${was} before Shoji changed anything, so it left ${old.length === 1 ? "that failure" : "those failures"} alone. ${
          status === "ready"
            ? "Everything else passes and the review approved the change."
            : "The review's notes above say what's left."
        }`,
      );
    }
    return finish(status);
  } catch (error) {
    if (error instanceof BudgetExceeded) return finish("stopped", error.message);
    if (error instanceof RefusedError) return finish("failed", error.message);
    return finish("failed", error instanceof Error ? error.message : String(error));
  }

  async function planFor(): Promise<string> {
    const asked = replan ? `\n\nThe person also asked: ${replan.notes}` : "";
    const brief = await agent("scout", "scout", stack.scout, prompts.SCOUT, `Task: ${task}${asked}`, READ_TOOLS);
    return step("plan", "plan", stack.plan, async () =>
      textOf(
        await meter.send("plan", "plan", {
          model: stack.plan.model,
          effort: stack.plan.effort,
          system: prompts.PLAN,
          messages: [
            {
              role: "user",
              content: withAttachments(
                `Task: ${task}${projectNotes(workspace)}${replanNotes()}\n\nScout's brief:\n${brief}\n\nRelevant files:\n${filesFrom(workspace, brief)}`,
                input.attachments,
              ),
            },
          ],
          maxTokens: MAX_TOKENS,
        }),
      ),
    );
  }

  /** An earlier plan and what the person asked to change in it. */
  function replanNotes(): string {
    return replan
      ? `\n\nAn earlier plan for this task:\n${replan.plan}\n\nThe person read it and asked for these changes to the plan:\n${replan.notes}`
      : "";
  }

  function finish(status: ThreadResult["status"], reason?: string): ThreadResult {
    const costByRole = Object.fromEntries(
      ROLES.map((role) => [role, meter.calls.filter((c) => c.role === role).reduce((sum, c) => sum + c.cost, 0)]),
    ) as Record<Role, number>;
    const result: ThreadResult = {
      status,
      reason,
      plan: state.plan,
      diff: diffOf(workspace.root),
      review: state.review,
      checks: state.checks,
      ...(failingBefore.size && { failingBefore: [...failingBefore] }),
      ...(testsBefore.size && { failingTestsBefore: [...testsBefore] }),
      escalated: state.escalated,
      cost: meter.spent,
      costByRole,
    };
    emit({ type: "result", result });
    return result;
  }
}

export function approves(review: string): boolean {
  return /^\s*VERDICT:\s*APPROVE/i.test(review);
}

/** SHOJI.md holds the project's own notes for the team, written during setup. */
function projectNotes(workspace: Workspace): string {
  const file = path.join(workspace.root, "SHOJI.md");
  return fs.existsSync(file) ? `\n\nProject notes (SHOJI.md):\n${fs.readFileSync(file, "utf8")}` : "";
}

/** The files the scout named on its FILES: line, read in full for the planner. */
function filesFrom(workspace: Workspace, brief: string): string {
  const line = brief.match(/FILES:\s*(.+)/)?.[1] ?? "";
  let out = "";
  for (const name of line.split(",").map((p) => p.trim().replace(/`/g, "")).filter(Boolean).slice(0, 6)) {
    try {
      out += `--- ${name}\n${workspace.read(name)}\n\n`;
    } catch {
      // The scout named something that isn't a readable file; the plan can do without it.
    }
  }
  return out.slice(0, MAX_FILES_CHARS) || "(none)";
}

export function reviewPrompt(task: string, diff: string, checks: CheckResult[]): string {
  const results = checks.length
    ? checks
        .map(
          (c) =>
            `${c.command}: ${
              c.ok
                ? "passed"
                : c.missing
                  ? "couldn't run, its program isn't installed here"
                  : c.failedBefore
                    ? `failed, and it failed before this change too, so it isn't this change's to fix\n${c.output}`
                    : c.newFailures
                      ? `failed. It failed before this change too, but these failures are new, so they are this change's to fix: ${c.newFailures.join(", ")}\n${c.output}`
                    : `failed\n${c.output}`
            }`,
        )
        .join("\n")
    : "No check commands are set for this project.";
  return `Task: ${task}\n\nDiff:\n${diff || "(no changes)"}\n\nChecks:\n${results}`;
}
