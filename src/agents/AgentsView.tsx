import type { LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { MODELS } from "../../runtime/src/models";
import { SECTIONS } from "../shell/sections";
import { foldRun, formatCost, stepLabel } from "../thread/fold";
import { threadCost, type Thread } from "../thread/useThread";
import { threadTitle } from "../thread/title";

export interface Agent {
  /** The thread as the ledger has it. */
  record: LedgerThread;
  /** Running, or what it waits for the person to do. */
  status: string;
  /** The thread as this session holds it, when it has run since Shoji opened: its live steps. */
  live?: Thread;
}

interface AgentsViewProps {
  agents: Agent[];
  showCosts: boolean;
  onOpen: (record: LedgerThread) => void;
  /** Opens the box for a new task, from the empty state. */
  onNew?: () => void;
  /** Acting on a card, without opening its thread. Accepting stays in the thread, where the changes are read. */
  onStop?: (record: LedgerThread) => void;
  onAnswer?: (record: LedgerThread, allow: boolean) => void;
  onBuild?: (record: LedgerThread) => void;
}

/** What a live thread is doing now, and the last file or command it touched. */
function doing(thread: Thread): { stage: string; target?: string } {
  const run = foldRun(thread.turns.at(-1)?.events ?? []);
  if (run.asking) return { stage: "Waiting for you to allow a command", target: run.asking };
  const now = run.steps.findLast((s) => s.running);
  if (!now) return { stage: "Starting" };
  return {
    stage: `${stepLabel(run.steps, run.steps.indexOf(now))} · ${MODELS[now.model].label}`,
    target: now.tools.at(-1)?.target,
  };
}

/** Every thread that's running or needs the person, side by side, to follow several at once. */
export function AgentsView({ agents, showCosts, onOpen, onNew, onStop, onAnswer, onBuild }: AgentsViewProps) {
  const waiting = agents.filter((a) => a.status !== "Running").length;
  const projects = new Set(agents.map((a) => a.record.repo)).size;
  return (
    <>
      <div className="mh">
        <h1>Agents</h1>
        {waiting > 0 && <span className="note">{waiting === 1 ? "1 needs you" : `${waiting} need you`}</span>}
      </div>
      {agents.length === 0 ? (
        <div className="empty">
          <h2>{SECTIONS.agents.title}</h2>
          <p>{SECTIONS.agents.body}</p>
          {onNew && (
            <button type="button" className="btn sm" onClick={onNew}>
              Start a task
            </button>
          )}
        </div>
      ) : (
        <div className="agents">
          <ul>
            {agents.map(({ record, status, live }) => {
              const running = status === "Running";
              const now = running && live ? doing(live) : null;
              const asking = running && live ? foldRun(live.turns.at(-1)?.events ?? []) : null;
              const name = threadTitle(record);
              const cost = live
                ? threadCost(live)
                : record.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
              return (
                <li key={record.id}>
                  <article aria-label={threadTitle(record)}>
                    <header>
                      <h2>{threadTitle(record)}</h2>
                      <span className="pill">
                        <span
                          className={running ? "dot" : "dot ok"}
                          data-running={running || undefined}
                          aria-hidden="true"
                        />
                        {running ? "running" : "needs you"}
                      </span>
                    </header>
                    <p className="stage">{now ? now.stage : status}</p>
                    {now?.target && <p className="target">{now.target}</p>}
                    <footer>
                      {asking?.asking !== undefined && onAnswer ? (
                        <>
                          <button
                            type="button"
                            className="btn sm solid"
                            aria-label={`Allow "${asking.asking}" for "${name}"`}
                            onClick={() => onAnswer(record, true)}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Don't allow "${asking.asking}" for "${name}"`}
                            onClick={() => onAnswer(record, false)}
                          >
                            Don't allow
                          </button>
                        </>
                      ) : status === "Plan ready" && onBuild ? (
                        <button
                          type="button"
                          className="btn sm solid"
                          aria-label={`Build the plan of "${name}"`}
                          onClick={() => onBuild(record)}
                        >
                          Build it
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={running || (status === "Plan ready" && onBuild) ? "btn sm" : "btn sm solid"}
                        onClick={() => onOpen(record)}
                      >
                        {running ? "Follow along" : status === "Plan ready" ? "Check the plan" : "Review changes"}
                      </button>
                      {running && live && onStop && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          aria-label={`Stop "${name}"`}
                          onClick={() => onStop(record)}
                        >
                          Stop
                        </button>
                      )}
                      <span className="meta">
                        {projects > 1 && <span>{folderName(record.repo)}</span>}
                        {showCosts && cost > 0 && <span>{formatCost(cost)}</span>}
                      </span>
                    </footer>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
