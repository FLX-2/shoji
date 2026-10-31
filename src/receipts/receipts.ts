import { MODELS, type ModelId } from "../../runtime/src/models";
import type { LedgerCall, LedgerThread } from "../bridge";
import { stackOf, stackSummary } from "../stack/lock";

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
  return stackOf(thread.stack)?.plan.model ?? "claude-opus-5-5";
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

/** A trial replays accepted tasks on another stack. It spends, but it isn't work to accept. */
export const isTrial = (thread: LedgerThread) => thread.runs[0]?.kind === "trial";

/** Scout reading a project to write its SHOJI.md. It spends once per project, and isn't work to accept either. */
export const isNotes = (thread: LedgerThread) => thread.runs[0]?.kind === "notes";

/** Accepted without a request for changes. */
export const firstTry = (thread: LedgerThread) =>
  accepted(thread) && !thread.runs.some((run) => run.kind === "changes");

/** "2026-10" for the month a thread started in, in local time. */
export function monthOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** What each day of a month cost, by when each call was made, from the 1st. */
export function dailySpend(threads: LedgerThread[], month: string): number[] {
  const [year, m] = month.split("-").map(Number);
  const days = new Array<number>(new Date(year, m, 0).getDate()).fill(0);
  for (const call of threads.flatMap(callsOf)) {
    if (monthOf(call.at) === month) days[new Date(call.at).getDate() - 1] += call.cost;
  }
  return days;
}

/** What each project's threads cost in a month, the dearest first. */
export function projectSpend(threads: LedgerThread[], month: string): { repo: string; spent: number }[] {
  const spent = new Map<string, number>();
  for (const t of threads) {
    if (monthOf(t.startedAt) === month) spent.set(t.repo, (spent.get(t.repo) ?? 0) + threadSpend(t));
  }
  return [...spent].map(([repo, cost]) => ({ repo, spent: cost })).sort((a, b) => b.spent - a.spent);
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
  /** Share of the month's threads accepted without a request for changes. Trials don't count. */
  firstTry: number | null;
  trials: number;
  /** Projects Scout read for their notes. */
  notes: number;
}

export function summarize(threads: LedgerThread[], month: string): MonthSummary {
  const inMonth = threads.filter((t) => monthOf(t.startedAt) === month);
  const spent = inMonth.reduce((sum, t) => sum + threadSpend(t), 0);
  const oneModel = inMonth.reduce((sum, t) => sum + oneModelCost(t), 0);
  const acceptedCount = inMonth.filter(accepted).length;
  const work = inMonth.filter((t) => !isTrial(t) && !isNotes(t));
  return {
    threads: inMonth,
    spent,
    saved: oneModel - spent,
    accepted: acceptedCount,
    perAccepted: acceptedCount ? spent / acceptedCount : null,
    firstTry: work.length ? work.filter(firstTry).length / work.length : null,
    trials: inMonth.filter(isTrial).length,
    notes: inMonth.filter(isNotes).length,
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
  if (isTrial(thread)) return thread.runs[0].status === null ? "Running" : "Trial";
  if (isNotes(thread)) {
    const status = thread.runs[0].status;
    if (status === null) return "Running";
    return status === "ready" ? "Notes written" : status === "stopped" ? "Stopped" : "Failed";
  }
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
    case "planned":
      return "Planned";
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
    stackSummary(t.stack),
    outcome(t),
    t.committed ?? "",
    t.runs.filter((run) => run.kind === "changes").length,
    threadSpend(t).toFixed(4),
    oneModelCost(t).toFixed(4),
    modelLabel(baselineModel(t)),
  ]);
  return [header, ...rows].map((row) => row.map(field).join(",")).join("\n") + "\n";
}
