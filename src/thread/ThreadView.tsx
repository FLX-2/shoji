import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { CheckResult } from "../../runtime/src/events";
import { MODELS } from "../../runtime/src/models";
import type { Bridge } from "../bridge";
import { CodeView } from "../code/CodeView";
import { useChanges } from "../code/useChanges";
import { Composer } from "../shell/Composer";
import {
  approves,
  foldRun,
  formatCost,
  modelName,
  reviewNotes,
  stepLabel,
  type RunView,
  type StepView,
  type ToolUse,
} from "./fold";
import { isRunning, threadCost, type Thread, type Turn } from "./useThread";

interface ThreadViewProps {
  bridge: Bridge;
  thread: Thread;
  onStop: () => void;
  onRequestChanges: (notes: string) => void;
  onCommit: () => Promise<void>;
}

const STATUS = {
  ready: "Ready to accept",
  "needs-work": "Needs work",
  stopped: "Stopped",
  failed: "Failed",
};

/** A thread: its Conversation, where each ask is followed by the steps that answered it,
 *  and its Code, the files it changed. */
export function ThreadView({ bridge, thread, onStop, onRequestChanges, onCommit }: ThreadViewProps) {
  const last = thread.turns[thread.turns.length - 1];
  const running = isRunning(last);
  const runs = thread.turns.map((turn) => foldRun(turn.events));
  const lastRun = runs[runs.length - 1];
  const spent = threadCost(thread);
  const [asking, setAsking] = useState(false);
  const scroller = useFollow(thread);
  const [mode, setMode] = useState<"conversation" | "code">("conversation");
  // Held here so the chosen file outlives switching to Conversation.
  const [chosenFile, setChosenFile] = useState<string | null>(null);
  // Read the project again whenever a run ends or Code opens.
  const ended = thread.turns.filter((t) => t.exit || t.error).length;
  const { changes, error, act } = useChanges(bridge, thread.repo, `${ended}-${mode}-${thread.committed}`);
  const fileCount = changes?.files.length ?? 0;
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const commit = () => {
    setCommitting(true);
    setCommitError(null);
    onCommit()
      .catch((e) => setCommitError(String(e)))
      .finally(() => setCommitting(false));
  };

  const now = lastRun.steps.findLast((s) => s.running);
  const stage = running
    ? now
      ? `${stepLabel(lastRun.steps, lastRun.steps.indexOf(now))} · ${MODELS[now.model].label}`
      : last.stoppedByYou
        ? "Stopping"
        : "Starting"
    : lastRun.result
      ? STATUS[lastRun.result.status]
      : last.stoppedByYou
        ? STATUS.stopped
        : STATUS.failed;

  return (
    <section className="thread">
      <div className="tbar solid">
        <h1>{thread.task.split("\n")[0]}</h1>
        <nav className="modes" aria-label="Views of this thread">
          <button
            type="button"
            className="mode"
            aria-current={mode === "conversation" ? "page" : undefined}
            onClick={() => setMode("conversation")}
          >
            Conversation
          </button>
          <button
            type="button"
            className="mode"
            aria-current={mode === "code" ? "page" : undefined}
            onClick={() => setMode("code")}
          >
            Code
            {fileCount > 0 && <span className="cnt">{count(fileCount, "file")}</span>}
          </button>
        </nav>
        <span className="stage">
          <span className="dot live" aria-hidden="true" />
          {stage}
        </span>
        {running && (
          <button type="button" className="btn sm" onClick={onStop} disabled={last.stoppedByYou}>
            Stop
          </button>
        )}
      </div>

      {mode === "code" && (
        <CodeView
          changes={changes}
          error={error}
          running={running}
          chosen={chosenFile}
          onChoose={setChosenFile}
          onAccept={(path) => act(bridge.acceptFile(thread.repo, path))}
          onRevert={(path) => act(bridge.revertFile(thread.repo, path))}
        />
      )}

      <div className="scroll" ref={scroller} hidden={mode !== "conversation"}>
        <div className="tcol">
          {thread.turns.map((turn, i) => (
            <TurnView key={i} turn={turn} run={runs[i]} live={running && i === thread.turns.length - 1} />
          ))}
        </div>
      </div>

      {mode === "conversation" &&
        !running &&
        (asking ? (
          <Composer
            label="Changes"
            placeholder="Describe the changes you want…"
            autoFocus
            onCancel={() => setAsking(false)}
            blocked={spent >= thread.cap}
            onSend={(notes) => {
              setAsking(false);
              onRequestChanges(notes);
            }}
          />
        ) : (
          <div className="review">
            {thread.committed ? (
              <span className="done">
                Committed <b>{thread.committed}</b> on {thread.branch}
              </span>
            ) : (
              <>
                {runs.some((run) => run.result?.plan) && (
                  <button type="button" className="btn" onClick={() => setAsking(true)} disabled={spent >= thread.cap}>
                    Request changes
                  </button>
                )}
                {thread.branch && fileCount > 0 && (
                  <button type="button" className="btn solid" onClick={commit} disabled={committing}>
                    Accept and commit
                  </button>
                )}
                {commitError && <span className="err">{commitError}</span>}
              </>
            )}
            <span className="sum">
              {dotted([
                !thread.committed && checksSummary(lastRun.result?.checks),
                <>
                  <b>{formatCost(spent)}</b> in all
                </>,
                !thread.committed && spent >= thread.cap && `the ${formatCost(thread.cap)} limit is spent`,
              ])}
            </span>
          </div>
        ))}
    </section>
  );
}

function TurnView({ turn, run, live }: { turn: Turn; run: RunView; live: boolean }) {
  return (
    <>
      <div className="umsg">{turn.ask}</div>
      <div className="amsg">
        <div className="bd">
          {run.steps.length > 0 && (
            <ol className="steps">
              {run.steps.map((_, i) => (
                <StepRow key={i} steps={run.steps} index={i} live={live} />
              ))}
            </ol>
          )}
          <Outcome turn={turn} run={run} live={live} />
        </div>
      </div>
    </>
  );
}

function StepRow({ steps, index, live }: { steps: StepView[]; index: number; live: boolean }) {
  const step = steps[index];
  const now = live && step.running;
  const finished = !step.running && !step.unfinished;
  return (
    <li className={now ? "st now" : finished ? "st done" : "st"}>
      <span className="c" aria-hidden="true">
        {finished ? "✓" : index + 1}
      </span>
      <div className="sb">
        <div className="sl">
          {stepLabel(steps, index)}
          <span className="m" title={step.cost > 0 ? `${MODELS[step.model].label} · ${formatCost(step.cost)}` : MODELS[step.model].label}>
            {modelName(step.model)}
          </span>
        </div>
        {step.escalation && (
          <p className="esc">
            Moved up to {MODELS[step.escalation.to].label}. {step.escalation.reason}
          </p>
        )}
        <Work step={step} />
      </div>
    </li>
  );
}

const READS = new Set(["read_file", "list_files", "search"]);
const EDITS = new Set(["write_file", "replace_in_file"]);

function Work({ step }: { step: StepView }) {
  const reads = step.tools.filter((t) => READS.has(t.tool));
  const edits = unique(step.tools.filter((t) => EDITS.has(t.tool)).map((t) => t.target));
  const commands = step.tools.filter((t) => t.tool === "run_command").map((t) => t.target);
  const output = step.output?.trim();

  const items = [
    reads.length > 0 && (
      <Item key="reads" icon={ICONS.file} summary={readSummary(reads)}>
        <ul className="files">
          {reads.map((t, i) => (
            <li key={i}>{readTarget(t)}</li>
          ))}
        </ul>
      </Item>
    ),
    edits.length > 0 && (
      <Item key="edits" icon={ICONS.edit} summary={listSummary("Edited", edits)}>
        <ul className="files">
          {edits.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </Item>
    ),
    commands.length > 0 && (
      <Item key="commands" icon={ICONS.term} summary={listSummary("Ran", unique(commands))}>
        <ul className="files">
          {commands.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </Item>
    ),
    step.checks && step.checks.length > 0 && <Checks key="checks" checks={step.checks} />,
    output && step.role === "scout" && (
      <Item key="out" icon={ICONS.note} summary="What the scout found">
        <div className="text">{output}</div>
      </Item>
    ),
    output && step.role === "plan" && step.name === "plan" && (
      <Item key="out" icon={ICONS.note} summary="The plan">
        <div className="text">{output}</div>
      </Item>
    ),
    output &&
      step.role === "review" &&
      (approves(output) ? (
        <Item key="out" icon={ICONS.note} summary="The review approved it">
          {reviewNotes(output) && <div className="text">{reviewNotes(output)}</div>}
        </Item>
      ) : (
        <Item key="out" icon={ICONS.note} summary="The review asked for fixes" open>
          <div className="text">{reviewNotes(output)}</div>
        </Item>
      )),
  ].filter(Boolean);

  const said = output && step.role === "build" ? output : null;
  if (items.length === 0 && !said) return null;
  return (
    <div className="work">
      {said && <p className="say">{said}</p>}
      {items}
    </div>
  );
}

function Checks({ checks }: { checks: CheckResult[] }) {
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <Item
      icon={ICONS.term}
      summary={failed ? `${failed} of ${count(checks.length, "check")} failed` : `${count(checks.length, "check")} passed`}
    >
      <pre className="tout">
        {checks.map((c) => (
          <span key={c.command}>
            <b>
              {c.ok ? "✓" : "✗"} {c.command}
            </b>
            {"\n"}
            {c.ok ? "" : `${c.output.trim()}\n`}
          </span>
        ))}
      </pre>
    </Item>
  );
}

function Item(props: { icon: string; summary: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="wk" open={props.open}>
      <summary>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={props.icon} />
        </svg>
        <span>{props.summary}</span>
        <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      {props.children}
    </details>
  );
}

function Outcome({ turn, run, live }: { turn: Turn; run: RunView; live: boolean }) {
  if (live) return null;
  const result = run.result;
  let text: string;
  if (turn.error) text = turn.error;
  else if (!result) text = turn.stoppedByYou ? "You stopped this thread." : turn.exit?.error || "The runtime quit before it finished.";
  else if (result.status === "ready")
    text = result.checks.length
      ? "Ready to accept. The checks pass and the review approved the change."
      : "Ready to accept. The review approved the change. This project has no checks to run.";
  else if (result.status === "needs-work")
    text = "This still needs work. The review's notes are above; request changes to carry on.";
  else text = result.reason ?? STATUS[result.status];
  return <p className={result?.status === "ready" ? "outcome" : "outcome warn"}>{text}</p>;
}

/** Keeps the conversation at its end while new work arrives, unless the person scrolled up. */
function useFollow(thread: Thread) {
  const ref = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [thread]);
  return ref;
}

/** The parts that are set, with a dot between each. */
function dotted(parts: ReactNode[]): ReactNode[] {
  return parts.filter(Boolean).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && " · "}
      {part}
    </Fragment>
  ));
}

function checksSummary(checks: CheckResult[] | undefined): string {
  if (!checks?.length) return "";
  const failed = checks.filter((c) => !c.ok).length;
  return failed ? `${failed} of ${count(checks.length, "check")} failed` : `${count(checks.length, "check")} passed`;
}

function readSummary(reads: ToolUse[]): string {
  const files = unique(reads.filter((t) => t.tool === "read_file").map((t) => t.target));
  return files.length ? listSummary("Read", files) : "Looked through the code";
}

function readTarget(t: ToolUse): string {
  if (t.tool === "search") return `search  ${t.target}`;
  if (t.tool === "list_files") return `list    ${t.target === "." ? "./" : `${t.target}/`}`;
  return `read    ${t.target}`;
}

function listSummary(verb: string, items: string[]): string {
  const name = items[0].split("/").pop();
  return items.length > 1 ? `${verb} ${name} and ${items.length - 1} more` : `${verb} ${name}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

const ICONS = {
  file: "M14 3H6v18h12V7l-4-4z",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  term: "M4 17l6-6-6-6M12 19h8",
  note: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
};
