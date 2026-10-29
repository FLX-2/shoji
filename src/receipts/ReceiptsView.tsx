import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bridge, LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { SECTIONS } from "../shell/sections";
import { formatCost } from "../thread/fold";
import {
  baselineModel,
  modelLabel,
  modelsUsed,
  monthName,
  months,
  outcome,
  receipt,
  summarize,
  threadSpend,
  toCsv,
} from "./receipts";

const STEPS: Record<string, string> = {
  scout: "Scout",
  plan: "Plan",
  build: "Build",
  changes: "Changes",
  "fix-1": "Fix",
  "fix-2": "Second fix",
  review: "Review",
  notes: "Project notes",
};

function counted(threads: number, trials: number, notes: number): string {
  const parts = [`${threads} ${threads === 1 ? "thread" : "threads"}`];
  if (trials) parts.push(`${trials} ${trials === 1 ? "trial" : "trials"}`);
  if (notes) parts.push(`${notes} ${notes === 1 ? "project read" : "project reads"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Dollars at one fixed precision, so a column of them lines up. */
function dollars(amount: number, places: 2 | 3): string {
  const smallest = 10 ** -places;
  return amount > 0 && amount < smallest / 2 ? `<$${smallest.toFixed(places)}` : `$${amount.toFixed(places)}`;
}

function when(at: number): string {
  return new Date(at).toLocaleString("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** What each month cost, what routing saved against one model, and a receipt for every thread. */
export function ReceiptsView({ bridge }: { bridge: Bridge }) {
  const [threads, setThreads] = useState<LedgerThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    bridge
      .ledgerThreads()
      .then(setThreads)
      .catch((e) => setError(String(e)));
  }, [bridge]);

  const all = useMemo(() => months(threads ?? []), [threads]);
  const shown = month ?? all[0];
  const summary = useMemo(() => (threads && shown ? summarize(threads, shown) : null), [threads, shown]);
  const open = summary?.threads.find((t) => t.id === chosen) ?? summary?.threads[0];

  const header = (children?: ReactNode) => (
    <div className="mh">
      <h1>Receipts</h1>
      {children}
    </div>
  );
  if (error || !threads || !summary || !shown) {
    return (
      <>
        {header()}
        {error ? (
          <div className="empty">
            <h2>Receipts couldn't be read</h2>
            <p>{error}</p>
          </div>
        ) : (
          threads && (
            <div className="empty">
              <h2>{SECTIONS.receipts.title}</h2>
              <p>{SECTIONS.receipts.body}</p>
            </div>
          )
        )}
      </>
    );
  }

  const at = all.indexOf(shown);
  const baselines = new Set(summary.threads.map(baselineModel));
  // The Project column earns its place only when the month spans more than one project.
  const projects = new Set(summary.threads.map((t) => t.repo)).size > 1;
  const exportCsv = () => {
    setExported(null);
    bridge
      .exportCsv(`shoji-receipts-${shown}.csv`, toCsv(summary.threads))
      .then((path) => path && setExported(`Saved ${folderName(path)}`))
      .catch((e) => setExported(String(e)));
  };

  return (
    <>
      {header(
        <>
          <div className="period">
            <button
              type="button"
              className="step"
              aria-label="Earlier month"
              disabled={at === all.length - 1}
              onClick={() => setMonth(all[at + 1])}
            >
              ‹
            </button>
            <span>{monthName(shown)}</span>
            <button
              type="button"
              className="step"
              aria-label="Later month"
              disabled={at === 0}
              onClick={() => setMonth(all[at - 1])}
            >
              ›
            </button>
          </div>
          <span className="r">
            {exported && <span className="note">{exported}</span>}
            <button type="button" className="btn sm" onClick={exportCsv}>
              Export CSV
            </button>
          </span>
        </>,
      )}

      <div className="receipts">
        <div className="rmain">
          <dl className="figures">
            <div>
              <dt>Spent</dt>
              <dd>{formatCost(summary.spent)}</dd>
              <dd className="s">
                {counted(summary.threads.length - summary.trials - summary.notes, summary.trials, summary.notes)}
              </dd>
            </div>
            <div>
              <dt>Saved against one model</dt>
              <dd>{formatCost(Math.max(0, summary.saved))}</dd>
              <dd className="s">
                {baselines.size === 1
                  ? `An estimate, if every step ran on ${modelLabel([...baselines][0])}`
                  : "An estimate, if every step ran on its thread's Plan model"}
              </dd>
            </div>
            <div>
              <dt>Per accepted task</dt>
              {summary.perAccepted === null ? (
                <dd className="s">Nothing accepted yet</dd>
              ) : (
                <>
                  <dd>{formatCost(summary.perAccepted)}</dd>
                  <dd className="s">{summary.accepted} accepted, counting all spend</dd>
                </>
              )}
            </div>
            <div>
              <dt>First-try accept</dt>
              <dd>{percent(summary.firstTry ?? 0)}</dd>
              <dd className="s">Accepted without a request for changes</dd>
            </div>
          </dl>

          <div
            className={projects ? "rtable" : "rtable one"}
            role="table"
            aria-label={`Threads in ${monthName(shown)}`}
          >
            <div className="rrow head" role="row">
              <span role="columnheader">Task</span>
              {projects && <span role="columnheader">Project</span>}
              <span role="columnheader">Models</span>
              <span role="columnheader">Outcome</span>
              <span role="columnheader" className="n">
                Cost
              </span>
            </div>
            {summary.threads.map((t) => (
              <button
                type="button"
                key={t.id}
                role="row"
                className="rrow"
                aria-current={t === open ? "true" : undefined}
                onClick={() => setChosen(t.id)}
              >
                <span role="cell" className="task">
                  {t.task.split("\n")[0]}
                </span>
                {projects && (
                  <span role="cell" title={t.repo}>
                    {folderName(t.repo)}
                  </span>
                )}
                <span role="cell">{modelsUsed(t).join(" · ")}</span>
                <span role="cell">{outcome(t)}</span>
                <span role="cell" className="n">
                  {dollars(threadSpend(t), 2)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {open && <ReceiptPane thread={open} />}
      </div>
    </>
  );
}

function ReceiptPane({ thread }: { thread: LedgerThread }) {
  const r = receipt(thread);
  const changes = thread.runs.filter((run) => run.kind === "changes").length;
  return (
    <aside className="rpane" aria-label="Receipt">
      <h2>{thread.task.split("\n")[0]}</h2>
      <p className="meta">
        {folderName(thread.repo)} · {when(thread.startedAt)}
      </p>
      {r.lines.length === 0 ? (
        <p className="meta">No model was called.</p>
      ) : (
        <>
          <ul className="lines">
            {r.lines.map((line, i) => (
              <li key={i}>
                <span>
                  {STEPS[line.step] ?? line.step}
                  <span className="m"> · {modelLabel(line.model)}</span>
                </span>
                <span className="n">{dollars(line.cost, 3)}</span>
              </li>
            ))}
          </ul>
          <ul className="lines quiet">
            <li>
              <span>Tokens in and out</span>
              <span className="n">
                {compact(r.tokensIn)} / {compact(r.tokensOut)}
              </span>
            </li>
            {r.cacheReuse !== null && (
              <li>
                <span>Read from cache</span>
                <span className="n">{percent(r.cacheReuse)}</span>
              </li>
            )}
            <li>
              <span>On {modelLabel(r.baseline)} alone, estimated</span>
              <span className="n">{dollars(r.oneModel, 3)}</span>
            </li>
          </ul>
        </>
      )}
      <p className="total">
        <span>Total</span>
        <span className="n">{dollars(r.total, 3)}</span>
      </p>
      <p className="meta">
        {thread.committed ? `Accepted as ${thread.committed} on ${thread.branch}` : outcome(thread)}
        {changes > 0 && ` · ${changes} ${changes === 1 ? "request" : "requests"} for changes`}
      </p>
    </aside>
  );
}

function compact(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1e6) return `${Math.round(tokens / 100) / 10}K`.replace(".0K", "K");
  return `${Math.round(tokens / 1e5) / 10}M`.replace(".0M", "M");
}
