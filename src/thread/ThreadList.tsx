import type { LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { formatCost } from "./fold";

const STATUS: Record<Exclude<LedgerThread["runs"][number]["status"], "answered" | null>, string> = {
  ready: "Ready to accept",
  "needs-work": "Needs work",
  planned: "Plan ready",
  stopped: "Stopped",
  failed: "Failed",
};

/** Where a thread got to: committed, or how its latest run ended. A question leaves the work as it was. */
export function threadStatus(thread: LedgerThread): string {
  if (thread.committed) return "Committed";
  if (thread.runs.at(-1)?.status === null) return "Running";
  const last = thread.runs.findLast((run) => run.kind !== "question")?.status;
  return last && last !== "answered" ? STATUS[last] : "Running";
}

function when(at: number, now: Date): string {
  const day = new Date(at);
  return day.toDateString() === now.toDateString()
    ? day.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface ThreadListProps {
  threads: LedgerThread[];
  /** The ledger id of the thread on show. */
  current?: number;
  showCosts: boolean;
  onOpen: (thread: LedgerThread) => void;
  onNew: () => void;
}

/** Every thread the person has started, newest first, to read again or carry on. */
export function ThreadList({ threads, current, showCosts, onOpen, onNew }: ThreadListProps) {
  const now = new Date();
  const projects = new Set(threads.map((t) => t.repo)).size;
  return (
    <nav className="tlist" aria-label="Threads">
      <div className="thead">
        <button type="button" className="btn sm ghost" onClick={onNew}>
          New task
        </button>
      </div>
      <ul>
        {threads.map((t) => {
          const status = threadStatus(t);
          const cost = t.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-current={t.id === current || undefined}
                onClick={() => t.id !== current && onOpen(t)}
              >
                <b>{t.task.split("\n")[0]}</b>
                <span className="meta">
                  {projects > 1 && <span>{folderName(t.repo)}</span>}
                  <span className={status === "Committed" ? "good" : status === "Failed" ? "bad" : undefined}>
                    {status}
                  </span>
                  {showCosts && cost > 0 && <span>{formatCost(cost)}</span>}
                  <span>{when(t.startedAt, now)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
