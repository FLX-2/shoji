import fs from "node:fs";
import path from "node:path";
import { MAX_TOKENS, runAgent, textOf } from "./agent";
import { runChecks } from "./commands";
import type { CheckResult, Emit, ThreadResult } from "./events";
import { diffOf } from "./git";
import { BudgetExceeded, Meter, RefusedError } from "./meter";
import * as prompts from "./prompts";
import type { ModelProvider } from "./provider";
import type { Role, Seat, Stack } from "./stack";
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
}

const ROLES: Role[] = ["scout", "plan", "build", "review"];
const MAX_FILES_CHARS = 60_000;

/**
 * Runs one thread: scout, plan, build, check, review. A build whose checks fail gets one
 * more try on the same model, then moves up to the plan model, as the MVP spec describes.
 * With `changes`, it runs again from the build on the person's notes.
 */
export async function runThread(input: ThreadInput): Promise<ThreadResult> {
  const { task, stack, workspace, checks, emit, changes } = input;
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
        prompt,
        tools,
        onTool: (tool, input) =>
          emit({ type: "tool", step: name, tool, target: input.path ?? input.pattern ?? input.command ?? "" }),
      }),
    );
  const check = (name: string) => {
    state.checks = runChecks(workspace.root, checks);
    emit({ type: "checks", step: name, results: state.checks });
    return state.checks.every((c) => c.ok);
  };
  const builderTools = [...READ_TOOLS, ...WRITE_TOOLS, ...(checks.length ? COMMAND_TOOLS : [])];
  const commandsNote = checks.length ? `\n\nCheck commands you can run: ${checks.join(", ")}` : "";

  try {
    state.plan = changes ? changes.plan : await planFor();
    const asked = changes ? `\n\nThe work so far is already in the project. The person asked for these changes:\n${changes.notes}` : "";
    const buildPrompt = `Task: ${task}\n\nPlan:\n${state.plan}${commandsNote}${asked}`;
    const buildStep = changes ? "changes" : "build";
    await agent(buildStep, "build", stack.build, prompts.BUILD, buildPrompt, builderTools);

    const fix = (name: string, seat: Seat, notes: string) =>
      agent(
        name,
        "build",
        seat,
        prompts.BUILD,
        `${buildPrompt}\n\nA first attempt is already in the project. Fix what's wrong:\n${notes}`,
        builderTools,
      );
    const failures = () =>
      state.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.command} failed:\n${c.output}`)
        .join("\n\n");

    let fixRounds = 0;
    let seat = stack.build;
    let passing = check(buildStep);
    if (!passing) {
      await fix("fix-1", seat, failures());
      fixRounds++;
      passing = check("fix-1");
    }
    if (!passing && stack.plan.model !== seat.model) {
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
            messages: [{ role: "user", content: reviewPrompt(task + asked, diffOf(workspace.root), state.checks) }],
            maxTokens: MAX_TOKENS,
          }),
        ),
      );

    state.review = await review();
    if (!approves(state.review) && fixRounds < 2) {
      await fix(`fix-${fixRounds + 1}`, seat, state.review);
      passing = check(`fix-${fixRounds + 1}`);
      state.review = await review();
    }

    return finish(passing && approves(state.review) ? "ready" : "needs-work");
  } catch (error) {
    if (error instanceof BudgetExceeded) return finish("stopped", error.message);
    if (error instanceof RefusedError) return finish("failed", error.message);
    return finish("failed", error instanceof Error ? error.message : String(error));
  }

  async function planFor(): Promise<string> {
    const brief = await agent("scout", "scout", stack.scout, prompts.SCOUT, `Task: ${task}`, READ_TOOLS);
    return step("plan", "plan", stack.plan, async () =>
      textOf(
        await meter.send("plan", "plan", {
          model: stack.plan.model,
          effort: stack.plan.effort,
          system: prompts.PLAN,
          messages: [
            {
              role: "user",
              content: `Task: ${task}${projectNotes(workspace)}\n\nScout's brief:\n${brief}\n\nRelevant files:\n${filesFrom(workspace, brief)}`,
            },
          ],
          maxTokens: MAX_TOKENS,
        }),
      ),
    );
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
    ? checks.map((c) => `${c.command}: ${c.ok ? "passed" : `failed\n${c.output}`}`).join("\n")
    : "No check commands are set for this project.";
  return `Task: ${task}\n\nDiff:\n${diff || "(no changes)"}\n\nChecks:\n${results}`;
}
