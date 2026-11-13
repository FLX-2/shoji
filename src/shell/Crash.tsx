import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Mark } from "./Mark";
import { WindowControls } from "./WindowControls";

interface CrashProps {
  /** Where the person is. Moving somewhere else clears the problem, since the next place may draw fine. */
  at?: string;
  /** What to show in place of the part that broke. `again` draws that part once more. */
  fallback: (problem: Error, again: () => void) => ReactNode;
  children: ReactNode;
}

interface CrashState {
  problem: Error | null;
  at?: string;
}

/**
 * Keeps a part of Shoji that fails to draw from taking the whole window with it. React removes everything when
 * a draw throws, which left an empty window with no way to move or close it. Runs don't stop: they work outside
 * the window, and the ledger keeps what they did.
 */
export class Crash extends Component<CrashProps, CrashState> {
  state: CrashState = { problem: null, at: this.props.at };

  static getDerivedStateFromError(thrown: unknown): Partial<CrashState> {
    return { problem: thrown instanceof Error ? thrown : new Error(String(thrown)) };
  }

  static getDerivedStateFromProps(props: CrashProps, state: CrashState): CrashState | null {
    return props.at === state.at ? null : { problem: null, at: props.at };
  }

  componentDidCatch(problem: Error, info: ErrorInfo) {
    console.error("Shoji couldn't draw a screen.", problem, info.componentStack);
  }

  render() {
    const { problem } = this.state;
    return problem ? this.props.fallback(problem, () => this.setState({ problem: null })) : this.props.children;
  }
}

/** What went wrong, for a bug report: the version, the error, and where in Shoji's code it came from. */
export function crashReport(problem: Error, version: string): string {
  return [`Shoji ${version}`, navigator.userAgent, "", problem.stack ?? String(problem)].join("\n");
}

/** Shown where a screen would be when it couldn't be drawn. */
export function Broken({ problem, version, onAgain }: { problem: Error; version: string; onAgain: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="empty broken" role="alert">
      <h2>This screen couldn't be shown</h2>
      <p>Something in it broke. Your threads and their work are safe, and anything running carries on.</p>
      <div className="acts">
        <button type="button" className="btn sm" onClick={onAgain}>
          Try again
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            navigator.clipboard?.writeText(crashReport(problem, version)).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? "Copied" : "Copy what went wrong"}
        </button>
      </div>
    </div>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** The whole window when Shoji itself couldn't be drawn: its title bar, so it can still be moved and closed, and
 *  the same words. */
export function BrokenWindow(props: { problem: Error; version: string; onAgain: () => void }) {
  return (
    <div className="app" data-state="idle" data-platform={isMac ? "mac" : "other"} data-status="hidden" data-opaque>
      <header className="titlebar solid" data-tauri-drag-region>
        <div data-tauri-drag-region />
        <div className="center" data-tauri-drag-region>
          <span className="lockup" data-tauri-drag-region>
            <Mark />
            shoji
          </span>
        </div>
        <div className="right" data-tauri-drag-region>
          {!isMac && <WindowControls />}
        </div>
      </header>
      <main className="main">
        <Broken {...props} />
      </main>
    </div>
  );
}
