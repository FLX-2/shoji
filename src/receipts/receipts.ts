import { MODELS, type ModelId } from "../../runtime/src/models";
import { STACKS, type StackName } from "../../runtime/src/stack";
import type { LedgerCall, LedgerThread } from "../bridge";

/** Cache writes cost this much more than plain input, as in the runtime's pricing. */
const CACHE_WRITE = 1.25;

function known(model: string): model is ModelId {
  return model in MODELS;
}

/** What a call would have cost on another model with the same tokens. */
export function priceAs(model: ModelId, call: LedgerCall): number {
  const p = MODELS[model];
  return (
    (call.inputTokens * p.input +
      call.cacheWriteTokens * p.input * CACHE_WRITE +
      call.cacheReadTokens * p.cacheRead +
      call.outputTokens * p.output) /
    1e6
  );
}

/** The one model a thread is compared against: its stack's Plan model. */
export function baselineModel(thread: LedgerThread): ModelId {
  const stack = STACKS[thread.stack as StackName];
  return stack ? stack.plan.model : "claude-opus-5-5";
}

export function callsOf(thread: LedgerThread): LedgerCall[] {
  return thread.runs.flatMap((run) => run.calls);
}

export function threadSpend(thread: LedgerThread): number {
  return callsOf(thread).reduce((sum, call) => sum + call.cost, 0);
}

/** The same calls priced as if every step had run on the baseline model. An estimate: that
 *  model would have taken its own path. A call on a model this version doesn't list keeps its cost. */
export function oneModelCost(thread: LedgerThread): number {
  const baseline = baselineModel(thread);
  return callsOf(thread).reduce((sum, call) => sum + (known(call.model) ? priceAs(baseline, call) : call.cost), 0);
}

export const accepted = (thread: LedgerThread) => thread.committed !== null;

/** Accepted without a request for changes. */
export const firstTry = (thread: LedgerThread) => accepted(thread) && thread.runs.every((run) => run.kind === "task");

/** "2026-10" for the month a thread started in, in local time. */
export function monthOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthName(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
}

export interface MonthSummary {
  threads: LedgerThread[];
  spent: number;
  /** One-model cost minus what was spent, across the month. */
  saved: number;
  accepted: number;
  /** Spend over accepted threads; rejected and abandoned threads still count as spend. */
  perAccepted: number | null;
  /** Share of the month's threads accepted without a request for changes. */
  firstTry: number | null;
}

export function summarize(threads: LedgerThread[], month: string): MonthSummary {
  const inMonth = threads.filter((t) => monthOf(t.startedAt) === month);
  const spent = inMonth.reduce((sum, t) => sum + threadSpend(t), 0);
  const oneModel = inMonth.reduce((sum, t) => sum + oneModelCost(t), 0);
  const acceptedCount = inMonth.filter(accepted).length;
  return {
    threads: inMonth,
    spent,
    saved: oneModel - spent,
    accepted: acceptedCount,
    perAccepted: acceptedCount ? spent / acceptedCount : null,
    firstTry: inMonth.length ? inMonth.filter(firstTry).length / inMonth.length : null,
  };
}

/** Months with threads, newest first. */
export function months(threads: LedgerThread[]): string[] {
  return [...new Set(threads.map((t) => monthOf(t.startedAt)))].sort().reverse();
}

export function modelLabel(model: string): string {
  return known(model) ? MODELS[model].label : model;
}

/** The models a thread used, short names in the order it first used them. */
export function modelsUsed(thread: LedgerThread): string[] {
  return [...new Set(callsOf(thread).map((call) => modelLabel(call.model).split(" ")[0]))];
}

export interface ReceiptLine {
  step: string;
  role: string;
  model: string;
  cost: number;
}

export interface Receipt {
  lines: ReceiptLine[];
  tokensIn: number;
  tokensOut: number;
  /** Share of input tokens read from the provider's cache. */
  cacheReuse: number | null;
  total: number;
  oneModel: number;
  baseline: ModelId;
}

/** A thread's calls, one line per step and model, in the order they ran. */
export function receipt(thread: LedgerThread): Receipt {
  const lines: ReceiptLine[] = [];
  for (const call of callsOf(thread)) {
    const last = lines[lines.length - 1];
    if (last && last.step === call.step && last.model === call.model) last.cost += call.cost;
    else lines.push({ step: call.step, role: call.role, model: call.model, cost: call.cost });
  }
  const calls = callsOf(thread);
  const tokensIn = calls.reduce((sum, c) => sum + c.inputTokens + c.cacheWriteTokens + c.cacheReadTokens, 0);
  const cached = calls.reduce((sum, c) => sum + c.cacheReadTokens, 0);
  return {
    lines,
    tokensIn,
    tokensOut: calls.reduce((sum, c) => sum + c.outputTokens, 0),
    cacheReuse: tokensIn ? cached / tokensIn : null,
    total: threadSpend(thread),
    oneModel: oneModelCost(thread),
    baseline: baselineModel(thread),
  };
}

/** How a thread ended, in a word or two. */
export function outcome(thread: LedgerThread): string {
  if (accepted(thread)) return "Accepted";
  const last = thread.runs[thread.runs.length - 1];
  switch (last?.status) {
    case null:
    case undefined:
      return "Running";
    case "ready":
      return "Not accepted";
    case "needs-work":
      return "Needs work";
    case "stopped":
      return "Stopped";
    default:
      return "Failed";
  }
}

function field(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per thread, every number in dollars to four places, for a spreadsheet. */
export function toCsv(threads: LedgerThread[]): string {
  const header = [
    "started",
    "task",
    "project",
    "branch",
    "stack",
    "outcome",
    "commit",
    "requests for changes",
    "cost",
    "one-model estimate",
    "one model",
  ];
  const rows = threads.map((t) => [
    new Date(t.startedAt).toISOString(),
    t.task.split("\n")[0],
    t.repo,
    t.branch,
    t.stack,
    outcome(t),
    t.committed ?? "",
    t.runs.filter((run) => run.kind === "changes").length,
    threadSpend(t).toFixed(4),
    oneModelCost(t).toFixed(4),
    modelLabel(baselineModel(t)),
  ]);
  return [header, ...rows].map((row) => row.map(field).join(",")).join("\n") + "\n";
}
