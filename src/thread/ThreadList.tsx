import { useState } from "react";
import type { LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { describeRepeat, describeWhen, nextDue, type Schedule } from "../schedule/schedule";
import { Menu, under, type MenuEntry } from "../shell/Menu";
import { formatCost } from "./fold";
import { threadTitle } from "./title";

const STATUS: Record<Exclude<LedgerThread["runs"][number]["status"], "answered" | null>, string> = {
  ready: "Ready to accept",
  "needs-work": "Needs work",
  planned: "Plan ready",
  stopped: "Stopped",
  failed: "Failed",
};

/** Where a thread got to: committed, or how its latest run ended. A question leaves the work as it was. */
export function threadStatus(thread: LedgerThread): string {
  if (thread.discardedAt) return "Discarded";
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

/** Where a thread stands: what's working, what's waiting for the person, and the rest. */
export type ThreadGroup = "Running" | "Needs you" | "Earlier";
/** The list's groups: pinned threads first, whatever their state, then by state. */
const GROUPS = ["Pinned", "Running", "Needs you", "Earlier"] as const;

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
  /** The ledger ids of threads that moved on since the person last looked at them. */
  unread?: Set<number>;
  showCosts: boolean;
  onOpen: (thread: LedgerThread) => void;
  onNew: () => void;
  /** Tasks Shoji starts by itself, which their own runs list below once they've run. */
  schedules?: Schedule[];
  onPause?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** The actions on a thread's ⋯ menu and right-click. */
  menuFor?: (thread: LedgerThread) => MenuEntry[];
  /** The ledger id of the thread whose name is being edited in the list. */
  renaming?: number | null;
  onStartRename?: (thread: LedgerThread) => void;
  /** The new name, or null when the person let it be. */
  onRenamed?: (thread: LedgerThread, title: string | null) => void;
}

/** A thread's name, edited in place: Enter keeps it, Escape or leaving lets it be. */
export function RenameField({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="rename"
      aria-label="Thread name"
      autoFocus
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim() && text.trim() !== value ? text.trim() : null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setText(value);
          onDone(null);
        }
      }}
    />
  );
}

/** Every thread the person has started, newest first, to read again or carry on. */
export function ThreadList({
  threads,
  running,
  current,
  unread,
  showCosts,
  onOpen,
  onNew,
  schedules = [],
  onPause,
  onRemove,
  menuFor,
  renaming = null,
  onStartRename,
  onRenamed,
}: ThreadListProps) {
  const now = new Date();
  const projects = new Set([...threads, ...schedules].map((t) => t.repo)).size;
  const listed = threads.map((thread) => ({ thread, ...threadState(thread, running) }));
  const shownNow = listed.filter((t) => !t.thread.archivedAt);
  const archived = listed.filter((t) => t.thread.archivedAt);
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<{ id: number; at: { x: number; y: number } } | null>(null);
  const menuThread = menu && threads.find((t) => t.id === menu.id);

  const row = ({ thread: t, status }: (typeof listed)[number]) => {
    const cost = t.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
    const title = threadTitle(t);
    return (
      <li
        key={t.id}
        data-menu={menu?.id === t.id || undefined}
        data-unread={unread?.has(t.id) || undefined}
        onContextMenu={(e) => {
          if (!menuFor || renaming === t.id) return;
          e.preventDefault();
          setMenu({ id: t.id, at: { x: e.clientX, y: e.clientY } });
        }}
      >
        {renaming === t.id ? (
          <div className="renaming">
            <RenameField value={title} onDone={(name) => onRenamed?.(t, name)} />
          </div>
        ) : (
          <button
            type="button"
            title={title}
            aria-current={t.id === current || undefined}
            onClick={() => t.id !== current && onOpen(t)}
            onKeyDown={(e) => {
              if (e.key === "F2" && onStartRename) {
                e.preventDefault();
                onStartRename(t);
              }
            }}
          >
            <b>{title}</b>
            <span className="meta">
              {projects > 1 && <span>{folderName(t.repo)}</span>}
              <span className={status === "Committed" ? "good" : status === "Failed" ? "bad" : undefined}>
                {status}
              </span>
              {showCosts && cost > 0 && <span>{formatCost(cost)}</span>}
              <span>{when(t.startedAt, now)}</span>
            </span>
            {unread?.has(t.id) && <i className="unread" role="img" aria-label="Unread" />}
          </button>
        )}
        {menuFor && renaming !== t.id && (
          <button
            type="button"
            className="more"
            aria-label={`More for "${title}"`}
            aria-haspopup="menu"
            aria-expanded={menu?.id === t.id}
            onClick={(e) => setMenu(menu?.id === t.id ? null : { id: t.id, at: under(e.currentTarget) })}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.1" />
              <circle cx="8" cy="8" r="1.1" />
              <circle cx="12.5" cy="8" r="1.1" />
            </svg>
          </button>
        )}
      </li>
    );
  };
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
          const shown = shownNow.filter((t) =>
            group === "Pinned" ? !!t.thread.pinned : !t.thread.pinned && t.group === group,
          );
          if (!shown.length) return null;
          return (
            <section key={group} aria-label={group}>
              <h2 className="k">{group}</h2>
              <ul>{shown.map(row)}</ul>
            </section>
          );
        })}
        {archived.length > 0 && (
          <section className="archived" aria-label="Archived">
            <button
              type="button"
              className="k fold"
              aria-expanded={showArchived}
              onClick={() => setShowArchived(!showArchived)}
            >
              Archived <span>{archived.length}</span>
            </button>
            {showArchived && <ul>{archived.map(row)}</ul>}
          </section>
        )}
      </div>
      {menu && menuThread && menuFor && (
        <Menu
          at={menu.at}
          label={`Actions for "${threadTitle(menuThread)}"`}
          items={menuFor(menuThread)}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
