import { useEffect, useRef } from "react";
import type { Bridge, LedgerThread } from "../bridge";
import { foldRun } from "./fold";
import { liveTitle } from "./title";
import { isRunning, type Thread, type Turn } from "./useThread";

/** What a notification says about a run that just ended, or null when there's nothing to tell, as when the
 *  person stopped it themselves. */
export function endedNote(turn: Turn): string | null {
  if (turn.stoppedByYou) return null;
  if (turn.error) return `Couldn't start: ${turn.error}`;
  const result = foldRun(turn.events).result;
  if (!result) return turn.exit?.error ? `Stopped: ${turn.exit.error}` : "Stopped before it finished.";
  switch (result.status) {
    case "ready":
      return "Ready to accept. The review approved the change.";
    case "planned":
      return "The plan is ready to read.";
    case "needs-work":
      return "The review sent it back with work left to do.";
    case "answered":
      return "Answered your question.";
    case "stopped":
      return "Stopped at its spending limit.";
    case "failed":
      return result.reason ? `Failed: ${result.reason}` : "Failed before it finished.";
  }
}

/** Where a live thread stands, as far as telling the person goes: its runs, what it asks, and whether it ended. */
function stateOf(thread: Thread): string {
  const last = thread.turns.at(-1);
  const asking = last && isRunning(last) ? (foldRun(last.events).asking ?? "") : "";
  return `${thread.turns.length}:${asking}:${last && !isRunning(last) ? "ended" : ""}`;
}

/**
 * Tells the person through the system when a thread starts waiting for them, asking to run a command or having
 * ended, unless they're looking at that thread in Shoji right now. `viewing` is the ledger id of the thread on
 * screen, if any.
 */
export function useNotify(bridge: Bridge, threads: Thread[], viewing: number | undefined, on: boolean) {
  const known = useRef(new Map<number, string>());
  const view = useRef(viewing);
  view.current = viewing;
  useEffect(() => {
    for (const thread of threads) {
      if (thread.id === undefined) continue;
      const state = stateOf(thread);
      const before = known.current.get(thread.id);
      known.current.set(thread.id, state);
      // A thread seen for the first time, as when it's reopened, has nothing new to tell.
      if (before === undefined || before === state || !on) continue;
      if (thread.id === view.current && document.hasFocus()) continue;
      const last = thread.turns.at(-1)!;
      const run = isRunning(last) ? foldRun(last.events) : undefined;
      const body = run?.asking
        ? `Wants to ${run.askingTool ? "use" : "run"} ${run.asking}. Open Shoji to allow it or not.`
        : !isRunning(last)
          ? endedNote(last)
          : null;
      if (body) bridge.notify(liveTitle(thread), body).catch(() => {});
    }
  }, [bridge, threads, on]);
}

/** How a thread's runs stand in the ledger, to tell whether something happened since the person last looked. */
export function seenMark(thread: LedgerThread): string {
  return `${thread.runs.length}:${thread.runs.at(-1)?.status ?? "running"}`;
}

/** Shows the count of threads waiting for the person on the app's icon, asking for attention when it rises. */
export function useWaitingBadge(bridge: Bridge, count: number) {
  const before = useRef(0);
  useEffect(() => {
    if (count === before.current) return;
    bridge.showWaiting(count, before.current).catch(() => {});
    before.current = count;
  }, [bridge, count]);
}
