import { useRef, useState } from "react";
import { commentOn, isOn, type LineComment } from "./comments";
import type { DiffLine, FileDiff, Hunk } from "./diff";
import type { Changes } from "./useChanges";

interface CodeViewProps {
  changes: Changes | null;
  error: string | null;
  /** True while a run is editing the project, when files can't be accepted or reverted. */
  running: boolean;
  /** The path the person picked; the first file when it's null or gone. */
  chosen: string | null;
  onChoose: (path: string) => void;
  onAccept: (path: string) => void;
  onRevert: (path: string) => void;
  /** Comments on lines of the diff, waiting to go to Build. */
  comments: LineComment[];
  /** Set when the thread can take changes; without it, lines can't be commented on. */
  onComments?: (comments: LineComment[]) => void;
  /** Sends the comments to Build as one request for changes. */
  onSendComments: () => void;
}

/** The thread's Code: every changed file, its diff, and accept or revert for each. */
export function CodeView({
  changes,
  error,
  running,
  chosen,
  onChoose,
  onAccept,
  onRevert,
  comments,
  onComments,
  onSendComments,
}: CodeViewProps) {
  // chosen and onChoose come from the parent so the choice outlives this view.
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
    onChoose(files[next].path);
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
              onClick={() => onChoose(f.path)}
            >
              <span className="fn">
                <b>{baseName(f.path)}</b>
                <span>{dirName(f.path)}</span>
              </span>
              <span className="fm">
                {accepted ? (
                  "accepted"
                ) : f.binary ? (
                  "binary"
                ) : (
                  <>
                    <span className="good">+{f.additions}</span> <span className="bad">−{f.deletions}</span>
                  </>
                )}
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
          comments={comments}
          onComments={onComments}
        />
      )}
      {comments.length > 0 && (
        <div className="cbar solid">
          <span>{comments.length === 1 ? "1 comment" : `${comments.length} comments`} for Build</span>
          {onComments && (
            <button type="button" className="btn sm ghost" onClick={() => onComments([])}>
              Clear
            </button>
          )}
          <button type="button" className="btn sm solid" disabled={!onComments} onClick={onSendComments}>
            Send to Build
          </button>
        </div>
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
  comments: LineComment[];
  onComments?: (comments: LineComment[]) => void;
}) {
  const { file, accepted, running, comments, onComments } = props;
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
              <span className="ask">
                {file.status === "added" ? "Delete this new file?" : "Discard this file's changes?"}
              </span>
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
              <button
                type="button"
                className="btn sm"
                disabled={running}
                title={busy}
                onClick={() => setConfirming(true)}
              >
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
          file.hunks.map((hunk, i) => (
            <HunkView
              key={i}
              hunk={hunk}
              gap={i > 0}
              notes={{ path: file.path, comments, ...(onComments && { onComments }) }}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface Notes {
  path: string;
  comments: LineComment[];
  /** Without it, the lines show their comments but take no new ones. */
  onComments?: (comments: LineComment[]) => void;
}

/** One stretch of change. `gap` marks the unchanged lines skipped since the last one. With `notes`,
 *  a line's number opens a comment on it, and its comments show beneath it. */
export function HunkView({ hunk, gap, notes }: { hunk: Hunk; gap: boolean; notes?: Notes }) {
  const [drafting, setDrafting] = useState<DiffLine | null>(null);
  return (
    <div className="hunk">
      {gap && <div className="hk" aria-label="Unchanged lines" />}
      {hunk.lines.map((line, i) => {
        const number = line.kind === "del" ? line.old : line.new;
        const here = notes?.comments.filter((c) => isOn(c, notes.path, line)) ?? [];
        return (
          <div key={i}>
            <div className={`l ${line.kind}`}>
              <span className="ln">{line.old ?? ""}</span>
              {notes?.onComments ? (
                <button
                  type="button"
                  className="ln"
                  aria-label={`Comment on ${line.kind === "del" ? "removed " : ""}line ${number}`}
                  onClick={() => setDrafting(line)}
                >
                  {line.new ?? ""}
                </button>
              ) : (
                <span className="ln">{line.new ?? ""}</span>
              )}
              <span className="tx">{line.text || " "}</span>
            </div>
            {here.map((c, n) => (
              <div key={n} className="lc">
                <p>{c.text}</p>
                {notes?.onComments && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => notes.onComments!(notes.comments.filter((x) => x !== c))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {drafting === line && notes?.onComments && (
              <Draft
                label={`Comment on line ${number}`}
                onCancel={() => setDrafting(null)}
                onAdd={(text) => {
                  notes.onComments!([...notes.comments, commentOn(notes.path, line, text)]);
                  setDrafting(null);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A comment being written under a line. Enter adds it; Shift+Enter adds a line; Escape drops it. */
function Draft({ label, onAdd, onCancel }: { label: string; onAdd: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const add = () => text.trim() && onAdd(text);
  return (
    <div className="lc draft">
      <textarea
        aria-label={label}
        placeholder="What should change here?"
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <span className="acts">
        <button type="button" className="btn sm ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm" disabled={!text.trim()} onClick={add}>
          Add comment
        </button>
      </span>
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
