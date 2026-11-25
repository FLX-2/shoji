import type { ComparedPage } from "../../runtime/src/compare";
import type { CheckResult, RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import { labelOf, type ModelId } from "../../runtime/src/models";
import type { Role } from "../../runtime/src/stack";

export interface ToolUse {
  tool: string;
  target: string;
}

/** What a running step is doing right now, and since when, when the runtime said. */
export interface Doing {
  what: "thinking" | "checks" | "tool";
  /** For a tool: which one, and what it was used on. */
  tool?: string;
  target?: string;
  at?: number;
}

/** One pipeline step as the conversation shows it. */
export interface StepView {
  name: string;
  role: Role;
  model: ModelId;
  running: boolean;
  /** Set when the run ended (failed or stopped) while this step was still going. */
  unfinished?: boolean;
  /** What the step wrote: the brief, the plan, the builder's summary or the review. */
  output?: string;
  tools: ToolUse[];
  checks?: CheckResult[];
  /** Set when the step moved up to a stronger model. */
  escalation?: { from: ModelId; to: ModelId; reason: string };
  /** What the person wrote to the run that this step took in, in order. */
  steers?: string[];
  /** While it runs: what it's doing now. */
  doing?: Doing;
  cost: number;
}

export interface RunView {
  steps: StepView[];
  result?: ThreadResult;
  cost: number;
  /** A command the run is waiting for the person to allow or turn down. */
  asking?: string;
  /** Set when what it's asking about is an MCP tool, named as "server: tool", rather than a command. */
  askingTool?: boolean;
  /** MCP servers the run couldn't reach, and why. */
  unreached?: { server: string; error: string }[];
  /** The pages Build looked at, before the work and after it, once the run has changed them. */
  compare?: { running: boolean; pages: ComparedPage[]; problem?: string };
  /** The name Scout gave the task, on its brief's TITLE: line. */
  title?: string;
  /** How many of the person's steers a step has taken in so far. */
  heard: number;
}

/** The name on a brief's TITLE: line, as the ledger reads it too. */
export function titleIn(brief: string): string | undefined {
  const line = brief
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("TITLE:"));
  const title = line
    ?.slice(6)
    .trim()
    .replace(/^["'*]+|["'*]+$/g, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 80);
  return title || undefined;
}

/** A brief without its TITLE: line, which only names the thread. */
const withoutTitle = (brief: string) =>
  brief
    .split("\n")
    .filter((l) => !l.trim().startsWith("TITLE:"))
    .join("\n")
    .trim();

/** Folds one run's events into its steps, in order. */
export function foldRun(events: RuntimeEvent[]): RunView {
  const steps: StepView[] = [];
  const escalations = new Map<string, StepView["escalation"]>();
  const last = (name: string) => steps.findLast((s) => s.name === name);
  let result: ThreadResult | undefined;
  let cost = 0;
  let asking: string | undefined;
  let askingTool = false;
  let title: string | undefined;
  const unreached: { server: string; error: string }[] = [];
  let compare: RunView["compare"];
  let heard = 0;

  for (const event of events) {
    switch (event.type) {
      case "step":
        if (event.status === "running") {
          steps.push({
            name: event.step,
            role: event.role,
            model: event.model,
            running: true,
            tools: [],
            escalation: escalations.get(event.step),
            doing: { what: "thinking", ...(event.at && { at: event.at }) },
            cost: 0,
          });
        } else {
          const step = last(event.step);
          let output = event.output;
          if (event.role === "scout") {
            title ??= titleIn(output);
            output = withoutTitle(output);
          }
          if (step) Object.assign(step, { running: false, output, doing: undefined });
        }
        break;
      case "tool": {
        const step = last(event.step);
        if (!step) break;
        step.tools.push({ tool: event.tool, target: event.target });
        if (step.running) step.doing = { what: "tool", tool: event.tool, target: event.target, ...(event.at && { at: event.at }) };
        break;
      }
      case "doing": {
        const step = last(event.step);
        if (step?.running) step.doing = { what: event.what, at: event.at };
        break;
      }
      case "checks": {
        const step = last(event.step);
        if (step) step.checks = event.results;
        break;
      }
      case "steered": {
        heard++;
        const step = last(event.step);
        if (step) step.steers = [...(step.steers ?? []), event.said];
        break;
      }
      case "escalate":
        escalations.set(event.step, { from: event.from, to: event.to, reason: event.reason });
        break;
      case "ask":
        asking = event.command;
        askingTool = !!event.tool;
        break;
      case "mcp":
        if ("error" in event) unreached.push({ server: event.server, error: event.error });
        break;
      case "answer":
        asking = undefined;
        break;
      case "compare":
        compare =
          event.status === "running"
            ? { running: true, pages: [] }
            : { running: false, pages: event.pages, ...(event.problem && { problem: event.problem }) };
        break;
      case "call": {
        cost += event.call.cost;
        const step = last(event.call.step);
        if (step) step.cost += event.call.cost;
        break;
      }
      case "result":
        result = event.result;
        cost = event.result.cost;
        asking = undefined;
        for (const step of steps) {
          if (!step.running) continue;
          step.running = false;
          step.unfinished = true;
          step.doing = undefined;
        }
        break;
    }
  }
  return {
    steps,
    result,
    cost,
    heard,
    ...(asking !== undefined && { asking, ...(askingTool && { askingTool }) }),
    ...(unreached.length && { unreached }),
    ...(compare && { compare }),
    ...(title && { title }),
  };
}

/** What a step is doing, or did, in a few words. */
export function stepLabel(steps: StepView[], index: number): string {
  const step = steps[index];
  const tense = (running: string, done: string) => (step.running || step.unfinished ? running : done);
  const before = steps.slice(0, index);
  switch (step.name) {
    case "scout":
      return tense("Reading the code", "Read the code");
    case "plan":
      return tense("Planning the change", "Planned the change");
    case "build":
      return tense("Making the change", "Made the change");
    case "changes":
      return tense("Making your changes", "Made your changes");
    case "answer":
      return tense("Reading the work to answer", "Answered");
    case "lead":
      return tense("Leading the work", "Led the work");
    case "review":
      return before.some((s) => s.name === "review")
        ? tense("Reviewing again", "Reviewed again")
        : tense("Reviewing the change", "Reviewed the change");
    default:
      return before.at(-1)?.name === "review"
        ? tense("Fixing what the review found", "Fixed what the review found")
        : tense("Fixing the failing checks", "Fixed the failing checks");
  }
}

/** What a running step is doing right now, in a few words. */
export function doingLabel(doing: Doing): string {
  if (doing.what === "thinking") return "Thinking";
  if (doing.what === "checks") return "Running the checks";
  const target = doing.target ?? "";
  switch (doing.tool) {
    case "read_file":
      return `Reading ${target}`;
    case "list_files":
      return target && target !== "." ? `Looking through ${target}` : "Looking through the project";
    case "search":
      return `Searching for ${target}`;
    case "write_file":
    case "replace_in_file":
      return `Editing ${target}`;
    case "run_command":
      return `Running ${target}`;
    case "look_at_page":
      return `Looking at ${target}`;
    case "read_skill":
      return `Reading the ${target} skill`;
    default:
      return target ? `Using ${target}` : "Working";
  }
}

/** A model's short name, as the conversation shows it beside each step. */
export function modelName(model: ModelId): string {
  return labelOf(model).split(" ")[0];
}

export function approves(review: string | undefined): boolean {
  return /^\s*VERDICT:\s*APPROVE/i.test(review ?? "");
}

/** The review without its verdict and look lines. */
export function reviewNotes(review: string): string {
  return review
    .replace(/^\s*VERDICT:\s*\w+\s*/i, "")
    .replace(/^\s*LOOK:.*(?:\r?\n|$)/im, "")
    .trim();
}

/** The look score the review gave the pages it saw, such as 8 for "LOOK: 8/10". */
export function lookScore(review: string | undefined): number | undefined {
  const found = (review ?? "").match(/^\s*LOOK:\s*(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*10\b/im);
  const score = found ? Number(found[1]) : NaN;
  return score >= 0 && score <= 10 ? score : undefined;
}

export function formatCost(dollars: number): string {
  return `$${dollars.toFixed(dollars === 0 || dollars >= 0.1 ? 2 : dollars < 0.01 ? 4 : 3)}`;
}
