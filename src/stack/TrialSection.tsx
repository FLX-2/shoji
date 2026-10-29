import { useEffect, useState } from "react";
import type { Stack } from "../../runtime/src/stack";
import type { TrialOutcome } from "../../runtime/src/trial";
import type { Bridge, LedgerThread, TrialRequest } from "../bridge";
import { HunkView } from "../code/CodeView";
import { parseDiff } from "../code/diff";
import { folderName } from "../home/HomeView";
import { formatCost } from "../thread/fold";
import { changedRoles, ROLE_NAMES, seatLabel } from "./lock";
import { trialProgress, type Trial } from "./useTrial";

interface TrialSectionProps {
  bridge: Bridge;
  repo: string | null;
  /** The saved stack, which the accepted tasks mostly ran on. */
  saved: Stack;
  /** The stack the trial would run: the one on screen, saved or not. */
  candidate: Stack;
  trial: Trial | null;
  onStart: (request: TrialRequest) => void;
  onStop: () => void;
}

const COUNTS = [3, 5, 10];

const STATUS: Record<TrialOutcome["status"], string> = {
  ready: "Ready",
  "needs-work": "Needs work",
  stopped: "Stopped at the limit",
  failed: "Failed",
  // Trials never pause for a plan.
  planned: "Planned",
};

/** What a candidate stack is, in words, beside the saved one. */
export function trialLabel(saved: Stack, candidate: Stack): string {
  const roles = changedRoles(saved, candidate);
  if (!roles.length) return "Trial of the saved stack";
  return `Trial: ${roles.map((role) => `${ROLE_NAMES[role].label} on ${seatLabel(candidate[role])}`).join(". ")}`;
}

/** The project's accepted threads, newest first, as tasks a trial can replay. */
export function replayable(threads: LedgerThread[], repo: string) {
  return threads.flatMap((t) =>
    t.repo === repo && t.committed && t.runs[0]?.kind === "task"
      ? [
          {
            task: t.task,
            commit: t.committed,
            // Only the first run: a trial replays the task, not later requests for changes.
            was: t.runs
              .filter((run) => run.kind === "task")
              .reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0),
          },
        ]
      : [],
  );
}

/** Replays recent accepted tasks on the stack above, and briefs on how it went. */
export function TrialSection({ bridge, repo, saved, candidate, trial, onStart, onStop }: TrialSectionProps) {
  const [threads, setThreads] = useState<LedgerThread[] | null>(null);
  const [count, setCount] = useState(5);
  const [cap, setCap] = useState("0.50");

  const finished = trial && !trialProgress(trial).running;
  useEffect(() => {
    bridge
      .ledgerThreads()
      .then(setThreads)
      .catch(() => setThreads([]));
  }, [bridge, finished]);

  const tasks = repo && threads ? replayable(threads, repo) : [];
  const options = [...new Set([...COUNTS.filter((n) => n < tasks.length), Math.min(tasks.length, 10)])];
  const chosen = options.includes(count) ? count : options[options.length - 1];
  const limit = Number(cap);
  const progress = trial && trialProgress(trial);

  const intro = !repo
    ? "Open a project on Home to run a trial on its work."
    : threads && !tasks.length
      ? `A trial replays accepted work. Accept a thread in ${folderName(repo)} first.`
      : `Replays your latest accepted tasks in ${repo ? folderName(repo) : "the project"} on the stack above, each in a scratch copy at the commit it started from. Your project isn't touched.`;

  return (
    <section className="trial" aria-labelledby="trial-h">
      <div>
        <h2 id="trial-h">Trial</h2>
        <p className="d">{intro}</p>
      </div>

      {repo && tasks.length > 0 && !progress?.running && (
        <div className="card">
          <div className="srow">
            <div>
              <b>Tasks to replay</b>
              <span className="d">The latest first.</span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Tasks to replay">
              {options.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={chosen === n} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="srow">
            <label htmlFor="trial-cap">
              <b>Limit for the trial</b>
              <span className="d">The trial stops before any call that could take it past this.</span>
            </label>
            <div className="money">
              <span aria-hidden="true">$</span>
              <input
                id="trial-cap"
                type="number"
                min={0.01}
                step={0.05}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
          </div>
          <div className="srow">
            <span className="d">{trialLabel(saved, candidate)}</span>
            <button
              type="button"
              className="btn sm solid"
              disabled={!(limit > 0)}
              onClick={() =>
                onStart({
                  repo,
                  label: trialLabel(saved, candidate),
                  stack: candidate,
                  cap: limit,
                  tasks: tasks.slice(0, chosen),
                })
              }
            >
              Run trial
            </button>
          </div>
        </div>
      )}

      {trial && progress && (
        <div className="briefing" aria-label="Trial briefing" role="region">
          {progress.running ? (
            <div className="trialrun">
              <span className="dot live" aria-hidden="true" />
              <span>
                {progress.task
                  ? `Replaying ${progress.task.index + 1} of ${progress.task.total}: ${progress.task.task.split("\n")[0]}`
                  : "Starting the trial"}
              </span>
              <span className="n">{formatCost(progress.spent)}</span>
              <button type="button" className="btn sm" onClick={onStop}>
                Stop
              </button>
            </div>
          ) : trial.error ? (
            <p className="d">The trial couldn't start: {trial.error}</p>
          ) : trial.stoppedByYou ? (
            <p className="d">You stopped the trial. It spent {formatCost(progress.spent)}.</p>
          ) : progress.briefing ? (
            <Briefing trial={trial} briefing={progress.briefing} />
          ) : (
            <p className="d">
              The trial ended before its briefing{trial.exit?.error ? `: ${trial.exit.error}` : "."} It spent{" "}
              {formatCost(progress.spent)}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Briefing({
  trial,
  briefing,
}: {
  trial: Trial;
  briefing: NonNullable<ReturnType<typeof trialProgress>["briefing"]>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const n = briefing.outcomes.length;
  const done = briefing.outcomes.filter((o) => o.status === "ready" || o.status === "needs-work");
  const cost = done.reduce((sum, o) => sum + o.cost, 0);
  const was = done.reduce((sum, o) => sum + o.was, 0);
  const change = was > 0 ? Math.round(((cost - was) / was) * 100) : null;
  return (
    <>
      <p className="bhead">
        {trial.request.label.replace(/^Trial: /, "")}
        <span className="meta">
          {" "}
          · {n} {n === 1 ? "task" : "tasks"} replayed
          {briefing.skipped > 0 && `, ${briefing.skipped} skipped at the limit`} · the trial cost{" "}
          {formatCost(briefing.cost)}
        </span>
      </p>
      <dl className="figures small">
        <div>
          <dt>Cost of the finished tasks</dt>
          {change === null ? (
            <dd className="s">No task finished</dd>
          ) : (
            <>
              <dd>{change <= 0 ? `${-change}% less` : `${change}% more`}</dd>
              <dd className="s">
                {formatCost(cost)}, against {formatCost(was)} when they first ran
              </dd>
            </>
          )}
        </div>
        <div>
          <dt>Checks passed</dt>
          <dd>
            {briefing.outcomes.filter((o) => o.checksPassed).length} of {n}
          </dd>
        </div>
        <div>
          <dt>Review approved</dt>
          <dd>
            {briefing.outcomes.filter((o) => o.approved).length} of {n}
          </dd>
        </div>
      </dl>
      <ul className="outcomes">
        {briefing.outcomes.map((o, i) => (
          <li key={i}>
            <span className="task">{o.task.split("\n")[0]}</span>
            <span className="meta">{STATUS[o.status]}</span>
            <span className="n">
              {formatCost(o.cost)} <span className="meta">was {formatCost(o.was)}</span>
            </span>
            {(o.diff || o.accepted) && (
              <button
                type="button"
                className="btn sm ghost"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                Compare
              </button>
            )}
            {o.reason && <span className="why">{o.reason}</span>}
            {open === i && (
              <div className="cmp">
                <DiffFiles label="This trial" diff={o.diff} empty="The trial changed nothing." />
                <DiffFiles label="What you accepted" diff={o.accepted} empty="The accepted commit couldn't be read." />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One side of a comparison: each file the diff touches, with its changes. */
function DiffFiles({ label, diff, empty }: { label: string; diff: string; empty: string }) {
  const files = parseDiff(diff);
  return (
    <section aria-label={label}>
      <h3>{label}</h3>
      <div className="diff">
        {files.length === 0 && <p className="note">{empty}</p>}
        {files.map((file) => (
          <div key={file.path} className="cf">
            <p className="cfh">
              <span className="path">{file.path}</span>
              <span className="meta">{file.binary ? "binary" : `+${file.additions} −${file.deletions}`}</span>
            </p>
            {file.hunks.map((hunk, i) => (
              <HunkView key={i} hunk={hunk} gap={i > 0} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
