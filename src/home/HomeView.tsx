import { useState } from "react";
import type { LedgerThread } from "../bridge";
import { REPEATS, type Repeat, type Schedule } from "../schedule/schedule";
import { ClipIcon } from "../shell/ClipIcon";
import { Composer } from "../shell/Composer";
import type { SlashCommand } from "../shell/mention";
import { fileName } from "../thread/useThread";
import { TIERS, type Tier } from "../stack/tier";
import { formatCost } from "../thread/fold";

interface HomeViewProps {
  repo: string | null;
  hasKey: boolean;
  onPickProject: () => void;
  onOpenSettings: () => void;
  /** New threads pause after the plan. */
  planFirst: boolean;
  onTogglePlanFirst: () => void;
  /** How much the task is worth, which moves the stack up or down for it. */
  tier: Tier;
  onTier: (tier: Tier) => void;
  /** What a task usually costs at this tier, once there's history to tell; null hides it. */
  estimate: number | null;
  /** Why the last task couldn't start in this folder, if it couldn't. */
  problem?: string | null;
  /** Asks for screenshots or files to attach, and resolves to their paths. */
  onPickAttachments: () => Promise<string[]>;
  /** Keeps a pasted image as a file, and resolves to its path. */
  onSavePasted: (image: File) => Promise<string>;
  /** Resolves to false when the task didn't start, so the composer keeps it and its files. */
  onStart: (task: string, attachments: string[]) => void | boolean | Promise<void | boolean>;
  /** Saves the task to run by itself on a schedule. */
  onSchedule: (task: string, when: Pick<Schedule, "repeat" | "time" | "day">) => void;
  /** The project's files, which the task can mention with @. */
  files: string[];
  /** The commands a task can start with, after a /. */
  commands: SlashCommand[];
  /** The project's threads that are running or wait for the person, latest first. */
  recent?: { thread: LedgerThread; status: string }[];
  onOpenThread?: (thread: LedgerThread) => void;
  showCosts?: boolean;
}

/** Start: pick a project and describe a change. */
export function HomeView({
  repo,
  hasKey,
  onPickProject,
  onOpenSettings,
  planFirst,
  onTogglePlanFirst,
  tier,
  onTier,
  estimate,
  problem,
  onPickAttachments,
  onSavePasted,
  onStart,
  onSchedule,
  files,
  commands,
  recent = [],
  onOpenThread = () => {},
  showCosts = true,
}: HomeViewProps) {
  const [attached, setAttached] = useState<string[]>([]);
  const [attachProblem, setAttachProblem] = useState<string | null>(null);
  const attach = async (paths: Promise<string[]>) => {
    try {
      const added = await paths;
      setAttached((now) => [...now, ...added.filter((path) => !now.includes(path))]);
      setAttachProblem(null);
    } catch (error) {
      setAttachProblem(String(error));
    }
  };
  const shown = problem ?? attachProblem;
  // Set while the task is to repeat rather than run once.
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(() => new Date().getDay());

  return (
    <div className="home">
      <div className="hwrap">
        <h1 className="hello">The right model for every step.</h1>
        <Composer
          hero
          label="Task"
          placeholder="Describe a change…"
          blocked={!repo || !hasKey}
          files={files}
          commands={commands}
          onSend={async (task) => {
            if (repeat) {
              onSchedule(task, { repeat, time, day });
              setRepeat(null);
              return;
            }
            const started = await onStart(task, attached);
            if (started !== false) setAttached([]);
            return started;
          }}
          onPasteImages={(images) => attach(Promise.all(images.map(onSavePasted)))}
          above={
            repeat ? (
              <div className="repeat">
                <div className="seg" role="radiogroup" aria-label="Repeat">
                  {(Object.keys(REPEATS) as Repeat[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={repeat === id}
                      onClick={() => setRepeat(id)}
                    >
                      {REPEATS[id]}
                    </button>
                  ))}
                </div>
                {repeat === "week" && (
                  <select aria-label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="time"
                  aria-label="Time"
                  value={time}
                  required
                  onChange={(e) => e.target.value && setTime(e.target.value)}
                />
                <span className="est">Runs by itself while Shoji is open</span>
              </div>
            ) : (
              attached.length > 0 && (
                <div className="attached">
                  {attached.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className="chip"
                      title={`Remove ${fileName(path)}`}
                      onClick={() => setAttached((now) => now.filter((p) => p !== path))}
                    >
                      <ClipIcon />
                      {fileName(path)}
                      <span className="x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )
            )
          }
        >
          {!repeat && (
            <button
              type="button"
              className="chip icon"
              aria-label="Attach screenshots or files"
              title="Attach screenshots or files. You can also paste a screenshot."
              onClick={() => attach(onPickAttachments())}
            >
              <ClipIcon />
            </button>
          )}
          <button type="button" className="chip" onClick={onPickProject} title={repo ?? undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h6l2 2h10v11H3z" />
            </svg>
            {repo ? folderName(repo) : "Choose a project"}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={repeat !== null}
            onClick={() => setRepeat(repeat ? null : "weekdays")}
            title="Run this task by itself on a schedule"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </svg>
            Repeat
          </button>
          {!repeat && (
            <button
              type="button"
              className="chip"
              aria-pressed={planFirst}
              onClick={onTogglePlanFirst}
              title="Pause after the plan, to build it or change it first"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {planFirst ? <path d="M5 12l5 5 9-10" /> : <path d="M6 12h12" />}
              </svg>
              Check the plan first
            </button>
          )}
          <div className="seg" role="radiogroup" aria-label="Quality">
            {(Object.keys(TIERS) as Tier[]).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={tier === id}
                title={TIERS[id].does}
                onClick={() => onTier(id)}
              >
                {TIERS[id].label}
              </button>
            ))}
          </div>
          {estimate !== null && (
            <span className="est" title="The middle of your recent tasks, priced on this tier's models">
              about {formatCost(estimate)}
            </span>
          )}
        </Composer>
        {shown ? (
          <p className="hint" role="alert">
            {shown}
          </p>
        ) : !hasKey ? (
          <p className="hint">
            Shoji needs your Anthropic API key to run.{" "}
            <button type="button" className="link" onClick={onOpenSettings}>
              Add it in Settings
            </button>
          </p>
        ) : !repo ? (
          <p className="hint">Choose a project folder. It must be a git repository.</p>
        ) : null}
        {recent.length > 0 && (
          <section className="recent" aria-labelledby="recent-h">
            <h2 id="recent-h" className="k">
              Pick up where you left off
            </h2>
            <ul>
              {recent.map(({ thread, status }) => {
                const cost = thread.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
                return (
                  <li key={thread.id}>
                    <button type="button" onClick={() => onOpenThread(thread)}>
                      <b>{thread.task.split("\n")[0]}</b>
                      <span className="meta">
                        <span
                          className={status === "Running" ? "dot" : "dot ok"}
                          data-running={status === "Running" || undefined}
                          aria-hidden="true"
                        />
                        <span>{status}</span>
                        {showCosts && cost > 0 && <span>{formatCost(cost)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
