import { useState } from "react";
import { ClipIcon } from "../shell/ClipIcon";
import { Composer } from "../shell/Composer";
import { fileName } from "../thread/useThread";
import { TIERS, type Tier } from "../stack/tier";
import { formatCost } from "../thread/fold";

interface HomeViewProps {
  repo: string | null;
  hasKey: boolean;
  /** True while a thread runs. M1 runs one thread at a time. */
  busy: boolean;
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
  /** The project's files, which the task can mention with @. */
  files: string[];
}

/** Start: pick a project and describe a change. */
export function HomeView({
  repo,
  hasKey,
  busy,
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
  files,
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

  return (
    <div className="home">
      <div className="hwrap">
        <h1 className="hello">The right model for every step.</h1>
        <Composer
          hero
          label="Task"
          placeholder="Describe a change…"
          blocked={!repo || !hasKey || busy}
          files={files}
          onSend={async (task) => {
            const started = await onStart(task, attached);
            if (started !== false) setAttached([]);
            return started;
          }}
          onPasteImages={(images) => attach(Promise.all(images.map(onSavePasted)))}
          above={
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
          }
        >
          <button
            type="button"
            className="chip icon"
            aria-label="Attach screenshots or files"
            title="Attach screenshots or files. You can also paste a screenshot."
            onClick={() => attach(onPickAttachments())}
          >
            <ClipIcon />
          </button>
          <button type="button" className="chip" onClick={onPickProject} title={repo ?? undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h6l2 2h10v11H3z" />
            </svg>
            {repo ? folderName(repo) : "Choose a project"}
          </button>
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
        ) : busy ? (
          <p className="hint">A thread is running. Shoji runs one at a time for now.</p>
        ) : !repo ? (
          <p className="hint">Choose a project folder. It must be a git repository with no uncommitted changes.</p>
        ) : null}
      </div>
    </div>
  );
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
