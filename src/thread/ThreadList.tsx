import type { LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { describeRepeat, describeWhen, nextDue, type Schedule } from "../schedule/schedule";
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

export function when(at: number, now: Date): string {
  const day = new Date(at);
  return day.toDateString() === now.toDateString()
    ? day.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The thread list's groups: what's working, what's waiting for the person, and the rest. */
const GROUPS = ["Running", "Needs you", "Earlier"] as const;
export type ThreadGroup = (typeof GROUPS)[number];

function groupOf(status: string): ThreadGroup {
  if (status === "Running") return "Running";
  if (status === "Ready to accept" || status === "Plan ready" || status === "Needs work") return "Needs you";
  return "Earlier";
}

/**
 * Where a thread stands now, and so its group. With `running`, the ledger ids of threads with a run going, a run
 * the ledger never saw end, as when Shoji closed during it, counts as stopped.
 */
export function threadState(thread: LedgerThread, running?: Set<number>): { status: string; group: ThreadGroup } {
  let status = threadStatus(thread);
  if (running && status === "Running" && !running.has(thread.id)) status = "Stopped";
  if (running?.has(thread.id)) status = "Running";
  return { status, group: groupOf(status) };
}

interface ThreadListProps {
  threads: LedgerThread[];
  /** The ledger ids of threads with a run going now. A run the ledger never saw end, as when Shoji closed during
   *  it, isn't running any more. */
  running?: Set<number>;
  /** The ledger id of the thread on show. */
  current?: number;
  showCosts: boolean;
  onOpen: (thread: LedgerThread) => void;
  onNew: () => void;
  /** Tasks Shoji starts by itself, which their own runs list below once they've run. */
  schedules?: Schedule[];
  onPause?: (id: string) => void;
  onRemove?: (id: string) => void;
}

/** Every thread the person has started, newest first, to read again or carry on. */
export function ThreadList({
  threads,
  running,
  current,
  showCosts,
  onOpen,
  onNew,
  schedules = [],
  onPause,
  onRemove,
}: ThreadListProps) {
  const now = new Date();
  const projects = new Set([...threads, ...schedules].map((t) => t.repo)).size;
  const listed = threads.map((thread) => ({ thread, ...threadState(thread, running) }));
  return (
    <nav className="tlist" aria-label="Threads">
      <div className="mh">
        <h2 className="title">Threads</h2>
        <button type="button" className="add" aria-label="New task" title="New task" onClick={onNew}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      </div>
      {schedules.length > 0 && (
        <section className="sched" aria-labelledby="sched-h">
          <h3 id="sched-h" className="k">
            Scheduled
          </h3>
          <ul>
            {schedules.map((s) => {
              const name = s.task.split("\n")[0];
              return (
                <li key={s.id}>
                  <div>
                    <b title={s.task}>{name}</b>
                    <span className="meta">
                      {projects > 1 && <span>{folderName(s.repo)}</span>}
                      <span>{describeRepeat(s)}</span>
                      <span>{s.paused ? "Paused" : `next ${describeWhen(nextDue(s, now), now)}`}</span>
                    </span>
                    {s.skipped && <span className="meta">Skipped last time: {s.skipped}</span>}
                  </div>
                  <button
                    type="button"
                    className="sw"
                    role="switch"
                    aria-checked={!s.paused}
                    aria-label={`Run "${name}" on schedule`}
                    onClick={() => onPause?.(s.id)}
                  />
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove "${name}"`}
                    title="Remove"
                    onClick={() => onRemove?.(s.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="groups">
        {GROUPS.map((group) => {
          const shown = listed.filter((t) => t.group === group);
          if (!shown.length) return null;
          return (
            <section key={group} aria-label={group}>
              <h2 className="k">{group}</h2>
              <ul>
                {shown.map(({ thread: t, status }) => {
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
            </section>
          );
        })}
      </div>
    </nav>
  );
}
