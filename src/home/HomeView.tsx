import { useState } from "react";
import type { LedgerThread } from "../bridge";
import { REPEATS, type Repeat, type Schedule } from "../schedule/schedule";
import { ClipIcon } from "../shell/ClipIcon";
import { SECTIONS } from "../shell/sections";
import { Composer } from "../shell/Composer";
import { Menu, SEPARATOR, under } from "../shell/Menu";
import type { SlashCommand } from "../shell/mention";
import { fileName } from "../thread/useThread";
import { TIERS, type Tier } from "../stack/tier";
import { formatCost } from "../thread/fold";
import { threadTitle } from "../thread/title";

/** A task brought back to Home: one to edit and start again, or a new one that carries on a committed thread. */
export interface HomeDraft {
  task: string;
  attachments: string[];
  /** The committed thread a new one carries on from: its branch, and its name to show. */
  from?: { branch: string; title: string };
}

interface HomeViewProps {
  repo: string | null;
  hasKey: boolean;
  onPickProject: () => void;
  /** The projects Shoji knows, latest first, for the project chip's menu. */
  projects?: string[];
  onChooseProject?: (repo: string) => void;
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
  /** Resolves to false when the task didn't start, so the composer keeps it and its files. With `from`, the new
   *  thread starts from that branch. */
  onStart: (task: string, attachments: string[], from?: string) => void | boolean | Promise<void | boolean>;
  /** What the box starts with, when a task was brought back to it. */
  draft?: HomeDraft | null;
  /** Saves the task to run by itself on a schedule. */
  onSchedule: (task: string, when: Pick<Schedule, "repeat" | "time" | "day">) => void;
  /** Puts the task in line, to start once nothing else runs. */
  onQueue?: (task: string) => void;
  /** The project's files, which the task can mention with @. */
  files: string[];
  /** The commands a task can start with, after a /. */
  commands: SlashCommand[];
  /** Earlier threads a task can mention with @, to carry their plan and review into it. */
  threads?: { id: number; title: string }[];
  /** The project's threads that are running or wait for the person, latest first. */
  recent?: { thread: LedgerThread; status: string }[];
  /** No thread has run yet, so Home says how Shoji works. */
  firstRun?: boolean;
  onOpenThread?: (thread: LedgerThread) => void;
  /** Opens Agents, where several threads that run or wait are looked after. */
  onOpenAgents?: () => void;
  showCosts?: boolean;
  /** What the page says above the box: Home's tagline, or what the Threads pane is for. */
  heading?: string;
  /** Tasks Scout's notes suggest for a first try in this project. */
  starters?: string[];
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
  onQueue,
  files,
  commands,
  threads,
  recent = [],
  firstRun = false,
  onOpenThread = () => {},
  onOpenAgents,
  showCosts = true,
  draft,
  heading = "The right model for every step.",
  projects = [],
  onChooseProject,
  starters = [],
}: HomeViewProps) {
  // A starter task the person picked, put in the box.
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const offer = firstRun && repo && hasKey ? starters : [];
  const [choosing, setChoosing] = useState<{ x: number; y: number } | null>(null);
  const others = projects.filter((p) => p !== repo);
  const [attached, setAttached] = useState<string[]>(draft?.attachments ?? []);
  const [from, setFrom] = useState(draft?.from);
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
  const [repeat, setRepeat] = useState<Repeat | "next" | null>(null);
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(() => new Date().getDay());

  return (
    <div className="home">
      <div className="hwrap">
        <h1 className="hello">{heading}</h1>
        <Composer
          key={seed?.n ?? 0}
          hero
          {...(offer[0] && { suggestion: offer[0] })}
          label="Task"
          placeholder={from ? "What should happen next?" : "Describe a change…"}
          initial={seed?.text ?? draft?.task}
          draft="task"
          autoFocus={!!draft || !!seed}
          blocked={!repo || !hasKey}
          files={files}
          commands={commands}
          {...(threads && { threads })}
          onSend={async (task) => {
            if (repeat === "next") {
              onQueue?.(task);
              setRepeat(null);
              return;
            }
            if (repeat) {
              onSchedule(task, { repeat, time, day });
              setRepeat(null);
              return;
            }
            const started = await onStart(task, attached, from?.branch);
            if (started !== false) {
              setAttached([]);
              setFrom(undefined);
            }
            return started;
          }}
          onPasteImages={(images) => attach(Promise.all(images.map(onSavePasted)))}
          sendLabel={repeat === "next" ? "Put it in line" : repeat ? "Save to the schedule" : "Start now"}
          sendAlso={
            <button
              type="button"
              className="also"
              aria-label="Schedule"
              aria-pressed={repeat !== null}
              title={repeat ? "Start it now instead" : "Run this task by itself on a schedule"}
              onClick={() => setRepeat(repeat ? null : "weekdays")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </svg>
            </button>
          }
          above={
            repeat ? (
              <div className="repeat">
                <div className="seg" role="radiogroup" aria-label="Repeat">
                  {onQueue && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={repeat === "next"}
                      title="Once, when no other thread is running"
                      onClick={() => setRepeat("next")}
                    >
                      Next in line
                    </button>
                  )}
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
                {repeat === "next" ? (
                  <span className="est">Starts when nothing else runs, within today's limit</span>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            ) : (
              (attached.length > 0 || from) && (
                <div className="attached">
                  {from && (
                    <button
                      type="button"
                      className="chip"
                      title={`Starts from ${from.branch}. Remove to start from the project's last commit.`}
                      onClick={() => setFrom(undefined)}
                    >
                      Carries on “{from.title}”
                      <span className="x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  )}
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
          <button
            type="button"
            className="chip"
            title={repo ?? undefined}
            {...(others.length > 0 && onChooseProject && { "aria-haspopup": "menu" as const, "aria-expanded": !!choosing })}
            onClick={(e) =>
              others.length > 0 && onChooseProject
                ? setChoosing(choosing ? null : under(e.currentTarget))
                : onPickProject()
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h6l2 2h10v11H3z" />
            </svg>
            {repo ? folderName(repo) : "Choose a project"}
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
        {choosing && onChooseProject && (
          <Menu
            at={choosing}
            label="Project"
            items={[
              ...projects.map((p) => ({
                label: folderName(p),
                ...(p === repo && { hint: "✓" }),
                run: () => onChooseProject(p),
              })),
              SEPARATOR,
              { label: "Open another folder…", run: onPickProject },
            ]}
            onClose={() => setChoosing(null)}
          />
        )}
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
        {firstRun && repo && hasKey && !shown && (
          <section className="firstrun" aria-label="How Shoji works">
            <p>{SECTIONS.home.body}</p>
            <ul>
              <li>
                <kbd>@</kbd> mentions a file, so the plan reads it in full.
              </li>
              <li>
                <kbd>/</kbd> starts with one of the project's commands from <code>.claude/commands</code>.
              </li>
              <li>
                <b>Check the plan first</b> stops after the plan, so you can change it before anything is built.
              </li>
              <li>Nothing is committed or pushed until you say so.</li>
            </ul>
            {offer.length > 0 && (
              <div className="starters">
                <h2 className="k">From Scout's read of the project</h2>
                {offer.map((task) => (
                  <button
                    key={task}
                    type="button"
                    className="chip"
                    onClick={() => setSeed((now) => ({ text: task, n: (now?.n ?? 0) + 1 }))}
                  >
                    {task}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {recent.length > 0 && (
          <section className="recent" aria-labelledby="recent-h">
            <h2 id="recent-h" className="k">
              Pick up where you left off
            </h2>
            <ul>
              {recent.length > 1 && onOpenAgents ? (
                <li>
                  <button type="button" onClick={onOpenAgents}>
                    <b>{waitingLine(recent)}</b>
                    <span className="meta">
                      <span>Open Agents to look after them</span>
                    </span>
                  </button>
                </li>
              ) : recent.map(({ thread, status }) => {
                const cost = thread.runs.reduce((sum, run) => sum + run.calls.reduce((s, c) => s + c.cost, 0), 0);
                return (
                  <li key={thread.id}>
                    <button type="button" onClick={() => onOpenThread(thread)}>
                      <b>{threadTitle(thread)}</b>
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

/** How many of a project's threads wait for the person and how many run, in a few words. */
function waitingLine(recent: { status: string }[]): string {
  const running = recent.filter((r) => r.status === "Running").length;
  const waiting = recent.length - running;
  return [
    waiting && (waiting === 1 ? "1 thread needs you" : `${waiting} threads need you`),
    running && (waiting ? `${running} running` : running === 1 ? "1 thread running" : `${running} threads running`),
  ]
    .filter(Boolean)
    .join(", ");
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
