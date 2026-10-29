import type { LedgerThread } from "../bridge";

/** What every call on the given day cost, by this computer's calendar. */
export function spentOn(threads: LedgerThread[], day: Date): number {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return threads
    .flatMap((t) => t.runs.flatMap((run) => run.calls))
    .filter((call) => call.at >= start && call.at < end)
    .reduce((sum, call) => sum + call.cost, 0);
}
