import { Composer } from "../shell/Composer";

interface HomeViewProps {
  repo: string | null;
  hasKey: boolean;
  /** True while a thread runs. M1 runs one thread at a time. */
  busy: boolean;
  onPickProject: () => void;
  onOpenSettings: () => void;
  /** Why the last task couldn't start in this folder, if it couldn't. */
  problem?: string | null;
  /** Resolves to false when the task didn't start, so the composer keeps it. */
  onStart: (task: string) => void | boolean | Promise<void | boolean>;
}

/** Start: pick a project and describe a change. */
export function HomeView({ repo, hasKey, busy, onPickProject, onOpenSettings, problem, onStart }: HomeViewProps) {
  return (
    <div className="home">
      <div className="hwrap">
        <h1 className="hello">The right model for every step.</h1>
        <Composer
          hero
          label="Task"
          placeholder="Describe a change…"
          blocked={!repo || !hasKey || busy}
          onSend={onStart}
        >
          <button type="button" className="chip" onClick={onPickProject} title={repo ?? undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h6l2 2h10v11H3z" />
            </svg>
            {repo ? folderName(repo) : "Choose a project"}
          </button>
        </Composer>
        {problem ? (
          <p className="hint" role="alert">
            {problem}
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
