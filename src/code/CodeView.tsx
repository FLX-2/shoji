import { useRef, useState } from "react";
import type { FileDiff, Hunk } from "./diff";
import type { Changes } from "./useChanges";

interface CodeViewProps {
  changes: Changes | null;
  error: string | null;
  /** True while a run is editing the project, when files can't be accepted or reverted. */
  running: boolean;
  onAccept: (path: string) => void;
  onRevert: (path: string) => void;
}

/** The thread's Code: every changed file, its diff, and accept or revert for each. */
export function CodeView({ changes, error, running, onAccept, onRevert }: CodeViewProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const files = changes?.files ?? [];
  const file = files.find((f) => f.path === chosen) ?? files[0];
  const list = useRef<HTMLElement>(null);

  /** Up and down arrows select and focus the previous or next file, stopping at the ends. */
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const at = file ? files.indexOf(file) : 0;
    const next = Math.min(Math.max(at + (e.key === "ArrowDown" ? 1 : -1), 0), files.length - 1);
    if (next === at) return;
    setChosen(files[next].path);
    list.current?.querySelectorAll<HTMLButtonElement>("button.fl")[next]?.focus();
  };

  if (changes && files.length === 0) {
    return (
      <div className="codeview">
        <div className="empty">
          <h2>No changes</h2>
          <p>{error ?? "The project matches its last commit."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="codeview">
      <nav className="files-list" aria-label="Changed files" ref={list} onKeyDown={move}>
        {files.map((f) => {
          const accepted = changes?.accepted.has(f.path);
          return (
            <button
              key={f.path}
              type="button"
              className="fl"
              aria-current={f === file ? "true" : undefined}
              onClick={() => setChosen(f.path)}
            >
              <span className="fn">
                <b>{baseName(f.path)}</b>
                <span>{dirName(f.path)}</span>
              </span>
              <span className="fm">
                {accepted ? "accepted" : f.binary ? "binary" : `+${f.additions} −${f.deletions}`}
              </span>
              <Bar file={f} />
            </button>
          );
        })}
      </nav>
      {file && (
        <FilePane
          key={file.path}
          file={file}
          accepted={!!changes?.accepted.has(file.path)}
          running={running}
          error={error}
          onAccept={() => onAccept(file.path)}
          onRevert={() => onRevert(file.path)}
        />
      )}
    </div>
  );
}

function FilePane(props: {
  file: FileDiff;
  accepted: boolean;
  running: boolean;
  error: string | null;
  onAccept: () => void;
  onRevert: () => void;
}) {
  const { file, accepted, running } = props;
  const [confirming, setConfirming] = useState(false);
  const busy = running ? "Wait for the run to finish" : undefined;

  return (
    <section className="diffpane" aria-label={file.path}>
      <header className="dh">
        <span className="path">{file.path}</span>
        <span className="what">{STATUS[file.status]}</span>
        <span className="acts">
          {confirming ? (
            <>
              <span className="ask">{file.status === "added" ? "Delete this new file?" : "Discard this file's changes?"}</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setConfirming(false);
                  props.onRevert();
                }}
              >
                {file.status === "added" ? "Delete" : "Discard"}
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn sm" disabled={running} title={busy} onClick={() => setConfirming(true)}>
                Revert
              </button>
              {accepted ? (
                <span className="done">Accepted</span>
              ) : (
                <button type="button" className="btn sm solid" disabled={running} title={busy} onClick={props.onAccept}>
                  Accept
                </button>
              )}
            </>
          )}
        </span>
      </header>
      {props.error && <p className="derr">{props.error}</p>}
      <div className="diff">
        {file.binary ? (
          <p className="note">This is a binary file, so there's no text to compare.</p>
        ) : (
          file.hunks.map((hunk, i) => <HunkView key={i} hunk={hunk} gap={i > 0} />)
        )}
      </div>
    </section>
  );
}

/** One stretch of change. `gap` marks the unchanged lines skipped since the last one. */
function HunkView({ hunk, gap }: { hunk: Hunk; gap: boolean }) {
  return (
    <div className="hunk">
      {gap && <div className="hk" aria-label="Unchanged lines" />}
      {hunk.lines.map((line, i) => (
        <div key={i} className={`l ${line.kind}`}>
          <span className="ln">{line.old ?? ""}</span>
          <span className="ln">{line.new ?? ""}</span>
          <span className="tx">{line.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

/** How much of the file's change is added and how much removed. */
function Bar({ file }: { file: FileDiff }) {
  const total = file.additions + file.deletions;
  if (!total) return null;
  return (
    <span className="bar" aria-hidden="true">
      <i style={{ width: `${(file.additions / total) * 100}%` }} />
      <u style={{ width: `${(file.deletions / total) * 100}%` }} />
    </span>
  );
}

const STATUS = { added: "new file", deleted: "deleted", modified: "changed" };

function baseName(path: string) {
  return path.split("/").pop();
}

function dirName(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}
