import type { CallRecord, RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import { parseStack, type Stack, STACKS, type StackName } from "../../runtime/src/stack";
import type { Bridge, LedgerThread } from "../bridge";
import { isNotes, isTrial } from "../receipts/receipts";
import type { Thread, Turn } from "./useThread";

/** The person's own threads, newest first: trials and project notes aren't threads they work in. */
export const workThreads = (ledger: LedgerThread[]) => ledger.filter((t) => !isTrial(t) && !isNotes(t));

/** What each kind of run asked, for runs from before the ledger kept the person's words. */
const ASKED: Record<Turn["kind"], string> = {
  task: "",
  changes: "Changes",
  build: "Build it",
  rebuild: "Build it again",
  review: "Review it again",
  replan: "Plan again",
  question: "Question",
};

const CUT_OFF = "Shoji closed before this run finished. The work it had done is kept.";

/**
 * A run Shoji closed during has no result. When it had written its plan, it ends here as a failed run with that
 * plan, so the thread can pick the work up where it stopped rather than start again.
 */
export function cutOff(events: RuntimeEvent[]): RuntimeEvent[] {
  if (events.some((e) => e.type === "result")) return events;
  const plan = events.findLast((e) => e.type === "step" && e.role === "plan" && e.status === "done");
  if (!plan || plan.type !== "step" || plan.status !== "done" || !plan.output.trim()) return events;
  const costByRole = { scout: 0, plan: 0, build: 0, review: 0 };
  for (const e of events) if (e.type === "call") costByRole[e.call.role] += e.call.cost;
  const result: ThreadResult = {
    status: "failed",
    reason: CUT_OFF,
    plan: plan.output,
    diff: "",
    review: "",
    checks: [],
    escalated: false,
    cost: Object.values(costByRole).reduce((a, b) => a + b, 0),
    costByRole,
  };
  return [...events, { type: "result", result }];
}

const ENDINGS: ThreadResult["status"][] = ["ready", "needs-work", "stopped", "failed", "planned", "answered"];
/** How a run ends only by its result, which it writes to its log. */
const WITH_RESULT = ["ready", "needs-work", "planned", "answered"];

/**
 * A past run whose log is gone, cleared with old data, read back from what the ledger keeps: each call with its
 * cost, and how the run ended. Its steps, plan and review went with the log.
 */
function fromLedger(run: LedgerThread["runs"][number]): RuntimeEvent[] {
  const costByRole = { scout: 0, plan: 0, build: 0, review: 0 };
  for (const call of run.calls) costByRole[call.role] += call.cost;
  const result: ThreadResult = {
    status: ENDINGS.find((status) => status === run.status) ?? "failed",
    plan: "",
    diff: "",
    review: "",
    checks: [],
    escalated: false,
    cost: run.calls.reduce((sum, call) => sum + call.cost, 0),
    costByRole,
  };
  // A ledger can hold a model this version no longer lists, which is shown by its id.
  const calls = run.calls.map(({ at: _, ...call }): RuntimeEvent => ({ type: "call", call: call as CallRecord }));
  return [...calls, { type: "result", result }];
}

function stackOf(saved: string): Stack {
  if (saved in STACKS) return STACKS[saved as StackName];
  try {
    return parseStack(saved);
  } catch {
    return STACKS.balanced;
  }
}

/**
 * Reads a past thread back from the ledger and its runs' logs, as the thread view shows a live one.
 * It can carry on with the person's current limit, or more if it has already spent more than that.
 */
export async function reopen(bridge: Bridge, record: LedgerThread, cap: number): Promise<Thread> {
  const runs = record.runs.filter((r): r is typeof r & { kind: Turn["kind"] } => r.kind in ASKED);
  const turns = await Promise.all(
    runs.map(async (run): Promise<Turn> => {
      const logged = await bridge.runEvents(run.id);
      // A run that made calls, or ended with a result, wrote a log. With the log gone, the ledger still says what
      // it cost and how it ended. One that failed or was stopped before its first call never had steps to show.
      const cleared = logged.length === 0 && (run.calls.length > 0 || WITH_RESULT.includes(run.status ?? ""));
      const events = cleared ? fromLedger(run) : run.status === "interrupted" ? cutOff(logged) : logged;
      // A run the person stopped ended without a result; one stopped at its limit says so in its result.
      const stoppedByYou = run.status === "stopped" && !events.some((e) => e.type === "result");
      return {
        ask: run.ask ?? (run.kind === "task" ? record.task : ASKED[run.kind]),
        kind: run.kind,
        events,
        // The run number only matters while a run is live; a past one has ended either way.
        exit: {
          run: 0,
          code: run.status === "failed" || run.status === "interrupted" ? 1 : 0,
          error: run.status === "interrupted" && !events.some((e) => e.type === "result") ? CUT_OFF : "",
        },
        ...(stoppedByYou && { stoppedByYou }),
        ...(cleared && { cleared }),
      };
    }),
  );
  const spent = record.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
  return {
    id: record.id,
    task: record.task,
    repo: record.repo,
    stack: stackOf(record.stack),
    cap: Math.max(cap, spent),
    branch: record.branch,
    ...(record.workdir && !record.discardedAt && { workdir: record.workdir }),
    ...(record.title && { title: record.title }),
    ...(record.discardedAt && { discarded: true }),
    ...(record.committed && { committed: record.committed }),
    turns,
  };
}
