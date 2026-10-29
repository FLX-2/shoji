import type { LedgerCall, LedgerThread } from "../bridge";
import { baselineModel, oneModelCost, threadSpend } from "./receipts";

/** Tasks from the routing spike: the routed run's calls, and what the same task really cost on Opus alone. */
export interface Spike {
  source: string;
  tasks: { task: string; opus: number; routed: Omit<LedgerCall, "at">[] }[];
}

export interface CheckRow {
  task: string;
  routed: number;
  /** What Receipts says the routed calls would have cost on the Plan model. */
  estimate: number;
  /** What the task cost when it really ran on that model. */
  real: number;
}

const saving = (row: Pick<CheckRow, "routed" | "estimate">, against: number) => 1 - row.routed / against;

/** Puts Receipts' one-model estimate beside the spike's real one-model runs. Calls no model. */
export function checkEstimate(spike: Spike) {
  const rows: CheckRow[] = spike.tasks.map(({ task, opus, routed }) => {
    const thread: LedgerThread = {
      id: 0,
      task,
      repo: "",
      branch: "",
      stack: "balanced",
      startedAt: 0,
      committed: null,
      committedAt: null,
      runs: [{ id: 0, kind: "task", startedAt: 0, status: "ready", calls: routed.map((c) => ({ ...c, at: 0 })) }],
    };
    if (baselineModel(thread) !== "claude-opus-5-5") throw new Error("The spike compared against Opus 5.5.");
    return { task, routed: threadSpend(thread), estimate: oneModelCost(thread), real: opus };
  });
  const sum = (key: "routed" | "estimate" | "real") => rows.reduce((total, row) => total + row[key], 0);
  const total = { task: "Total", routed: sum("routed"), estimate: sum("estimate"), real: sum("real") };
  return {
    rows,
    total,
    /** How far the one-model estimate sits from the real one-model cost, as a share of the real cost. */
    estimateGap: total.estimate / total.real - 1,
    estimatedSaving: saving(total, total.estimate),
    realSaving: saving(total, total.real),
  };
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/** The check as a plain table, for the terminal. */
export function formatCheck(check: ReturnType<typeof checkEstimate>): string {
  const head = ["Task", "Routed", "Estimate on Opus", "Real Opus run", "Estimated saving", "Real saving"];
  const line = (row: CheckRow) => [
    row.task,
    `$${row.routed.toFixed(3)}`,
    `$${row.estimate.toFixed(3)}`,
    `$${row.real.toFixed(3)}`,
    pct(saving(row, row.estimate)),
    pct(saving(row, row.real)),
  ];
  const cells = [head, ...check.rows.map(line), line(check.total)];
  const widths = head.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  const text = cells.map((row) =>
    row.map((cell, i) => (i ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join("   "),
  );
  const under = check.estimateGap < 0;
  return [
    ...text.slice(0, -1),
    "",
    text[text.length - 1],
    "",
    `The one-model estimate is ${pct(Math.abs(check.estimateGap))} ${under ? "under" : "over"} the real Opus runs.`,
    `Estimated saving ${pct(check.estimatedSaving)}, measured ${pct(check.realSaving)}.`,
  ].join("\n");
}
