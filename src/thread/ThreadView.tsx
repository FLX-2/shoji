import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { CheckResult } from "../../runtime/src/events";
import { MODELS } from "../../runtime/src/models";
import type { Bridge } from "../bridge";
import { CodeView } from "../code/CodeView";
import { useChanges } from "../code/useChanges";
import { ClipIcon } from "../shell/ClipIcon";
import { ROLE_NAMES } from "../stack/lock";
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
import { Markdown } from "./Markdown";
import { fileName, isRunning, threadCost, type Thread, type Turn } from "./useThread";

interface ThreadViewProps {
  bridge: Bridge;
  thread: Thread;
  onStop: () => void;
  onRequestChanges: (notes: string) => void;
  /** Gives a thread that stopped at its limit more to spend, and carries on. */
  onKeepGoing: () => void;
  /** Gives a thread the review sent back more to spend, and works through the review's notes. */
  onFix: () => void;
  /** How much more Keep going and Fix it allow, in dollars. */
  more: number;
  /** Starts a thread that couldn't start over again. */
  onRetry: () => void;
  /** Builds the plan the person has read. */
  onBuild: () => void;
  /** Plans again from the person's notes on the plan. */
  onReplan: (notes: string) => void;
  onCommit: () => Promise<void>;
  /** The person's answer about a command the run wants; `always` allows it in this project from now on. */
  onAnswer: (command: string, allow: boolean, always: boolean) => Promise<void>;
  /** What the thread has cost, on the review bar. Off in Settings hides it. */
  showCosts: boolean;
}

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const SHORTCUT = MAC ? "⌘" : "Ctrl+";

const STATUS = {
  ready: "Ready to accept",
  "needs-work": "Needs work",
  stopped: "Stopped",
  failed: "Failed",
  planned: "Plan ready",
};

/** A thread: its Conversation, where each ask is followed by the steps that answered it,
 *  and its Code, the files it changed. */
export function ThreadView({
  bridge,
  thread,
  onStop,
  onRequestChanges,
  onKeepGoing,
  onFix,
  more,
  onRetry,
  onBuild,
  onReplan,
  onCommit,
  onAnswer,
  showCosts,
}: ThreadViewProps) {
  const last = thread.turns[thread.turns.length - 1];
  const running = isRunning(last);
  const runs = thread.turns.map((turn) => foldRun(turn.events));
  const lastRun = runs[runs.length - 1];
  const spent = threadCost(thread);
  const [asking, setAsking] = useState(false);
  const scroller = useFollow(thread);
  const [mode, setMode] = useState<"conversation" | "code">("conversation");
  useModeKeys(setMode);
  // Held here so the chosen file outlives switching to Conversation.
  const [chosenFile, setChosenFile] = useState<string | null>(null);
  // Read the project again whenever a run ends or Code opens.
  const ended = thread.turns.filter((t) => t.exit || t.error).length;
  const { changes, error, act } = useChanges(bridge, thread.repo, `${ended}-${mode}-${thread.committed}`);
  const fileCount = changes?.files.length ?? 0;
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Stopped at its limit, so the way on is more to spend.
  const stopped = lastRun.result?.status === "stopped";
  // Paused after the plan, for the person to build it or ask for a different one.
  const planned = lastRun.result?.status === "planned";
  // The review sent it back. Fixing can't help a check whose program isn't on this computer.
  const fixable = lastRun.result?.status === "needs-work" && !lastRun.result.checks.some((c) => c.missing);
  const outcome = running ? undefined : lastRun.result ? lastRun.result.status : last.stoppedByYou ? "stopped" : "failed";

  const commit = () => {
    setCommitting(true);
    setCommitError(null);
    onCommit()
      .catch((e) => setCommitError(String(e)))
      .finally(() => setCommitting(false));
  };

  const now = lastRun.steps.findLast((s) => s.running);
  const stage = running
    ? lastRun.asking
      ? "Waiting for you"
      : now
      ? (
          <>
            {stepLabel(lastRun.steps, lastRun.steps.indexOf(now))}
            <span className="mn"> · {MODELS[now.model].label}</span>
          </>
        )
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
            title={`Conversation (${SHORTCUT}1)`}
            onClick={() => setMode("conversation")}
          >
            Conversation
          </button>
          <button
            type="button"
            className="mode"
            aria-current={mode === "code" ? "page" : undefined}
            title={`Code (${SHORTCUT}2)`}
            onClick={() => setMode("code")}
          >
            Code
            {fileCount > 0 && <span className="cnt">{count(fileCount, "file")}</span>}
          </button>
        </nav>
        <div className="tend">
          <span className="stage" data-outcome={outcome}>
            <span className="dot live" aria-hidden="true" />
            {stage}
          </span>
          {running && (
            <button type="button" className="btn sm" onClick={onStop} disabled={last.stoppedByYou}>
              Stop
            </button>
          )}
        </div>
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
            <TurnView
              key={i}
              turn={turn}
              run={runs[i]}
              live={running && i === thread.turns.length - 1}
              waiting={planned && i === thread.turns.length - 1}
            />
          ))}
        </div>
      </div>

      {mode === "conversation" && running && lastRun.asking && (
        <CommandAsk
          key={lastRun.asking}
          command={lastRun.asking}
          step={now ? ROLE_NAMES[now.role].label : undefined}
          project={fileName(thread.repo)}
          onAnswer={(allow, always) => onAnswer(lastRun.asking!, allow, always)}
        />
      )}

      {mode === "conversation" &&
        !running &&
        (asking ? (
          <Composer
            label={planned ? "Plan changes" : "Changes"}
            placeholder={planned ? "What should the plan do differently?" : "Describe the changes you want…"}
            autoFocus
            onCancel={() => setAsking(false)}
            blocked={spent >= thread.cap}
            onSend={(notes) => {
              setAsking(false);
              (planned ? onReplan : onRequestChanges)(notes);
            }}
          />
        ) : planned ? (
          <div className="review">
            <button type="button" className="btn solid" onClick={onBuild}>
              Build it
            </button>
            <button type="button" className="btn" onClick={() => setAsking(true)} disabled={spent >= thread.cap}>
              Change the plan
            </button>
            <span className="sum">
              {dotted([
                showCosts && (
                  <>
                    <b>{formatCost(spent)}</b> so far
                  </>
                ),
              ])}
            </span>
          </div>
        ) : (
          <div className="review">
            {thread.committed ? (
              <span className="done">
                Committed <b>{thread.committed}</b> on {thread.branch}
              </span>
            ) : (
              <>
                {thread.id === undefined && last.error && (
                  <button type="button" className="btn solid" onClick={onRetry}>
                    Try again
                  </button>
                )}
                {stopped && (
                  <button type="button" className="btn solid" onClick={onKeepGoing}>
                    Keep going, up to {formatCost(more)} more
                  </button>
                )}
                {fixable && (
                  <button type="button" className="btn solid" onClick={onFix}>
                    Fix it, up to {formatCost(more)} more
                  </button>
                )}
                {runs.some((run) => run.result?.plan) && (
                  <button type="button" className="btn" onClick={() => setAsking(true)} disabled={spent >= thread.cap}>
                    Request changes
                  </button>
                )}
                {thread.branch && fileCount > 0 && (
                  <button
                    type="button"
                    className={stopped || fixable ? "btn" : "btn solid"}
                    onClick={commit}
                    disabled={committing}
                  >
                    Accept and commit
                  </button>
                )}
                {commitError && <span className="err">{commitError}</span>}
              </>
            )}
            <span className="sum">
              {dotted([
                !thread.committed && checksSummary(lastRun.result?.checks),
                showCosts && (
                  <>
                    <b>{formatCost(spent)}</b> in all
                  </>
                ),
                !thread.committed && spent >= thread.cap && `the ${formatCost(thread.cap)} limit is spent`,
              ])}
            </span>
          </div>
        ))}
    </section>
  );
}

/** A run waiting for the person to allow a command beyond the project's checks. */
function CommandAsk({
  command,
  step,
  project,
  onAnswer,
}: {
  command: string;
  step?: string;
  project: string;
  onAnswer: (allow: boolean, always: boolean) => Promise<void>;
}) {
  const [sent, setSent] = useState(false);
  const answer = (allow: boolean, always = false) => {
    setSent(true);
    onAnswer(allow, always).catch(() => setSent(false));
  };
  return (
    <div className="review cmdask" role="alertdialog" aria-label="Allow this command?">
      <p>
        {step ?? "Shoji"} wants to run <code>{command}</code>. Checks run on their own; anything else waits for you.
      </p>
      <button type="button" className="btn solid" onClick={() => answer(true)} disabled={sent}>
        Allow
      </button>
      <button type="button" className="btn" onClick={() => answer(true, true)} disabled={sent}>
        Always allow in {project}
      </button>
      <button type="button" className="btn" onClick={() => answer(false)} disabled={sent}>
        Don't allow
      </button>
    </div>
  );
}

/** `waiting` marks the turn whose plan is waiting for the person, so the plan shows open. */
function TurnView({ turn, run, live, waiting }: { turn: Turn; run: RunView; live: boolean; waiting: boolean }) {
  return (
    <>
      <div className="umsg">
        {turn.ask}
        {turn.attached && (
          <div className="attached">
            {turn.attached.map((name, i) => (
              <span key={i} className="chip">
                <ClipIcon />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="amsg">
        <div className="bd">
          {run.steps.length > 0 && (
            <ol className="steps">
              {run.steps.map((_, i) => (
                <StepRow key={i} steps={run.steps} index={i} live={live} showPlan={waiting} />
              ))}
            </ol>
          )}
          <Outcome turn={turn} run={run} live={live} />
        </div>
      </div>
    </>
  );
}

function StepRow({
  steps,
  index,
  live,
  showPlan,
}: {
  steps: StepView[];
  index: number;
  live: boolean;
  showPlan: boolean;
}) {
  const step = steps[index];
  const now = live && step.running;
  const finished = !step.running && !step.unfinished;
  return (
    <li className={now ? "st now" : finished ? "st done" : "st"}>
      <span className="c" aria-hidden="true">
        {finished && (
          <svg viewBox="0 0 12 12">
            <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        )}
      </span>
      <div className="sb">
        <div className="sl">
          {stepLabel(steps, index)}
          <span className="m mn" title={step.cost > 0 ? `${MODELS[step.model].label} · ${formatCost(step.cost)}` : MODELS[step.model].label}>
            {modelName(step.model)}
          </span>
        </div>
        {step.escalation && (
          <p className="esc">
            Moved up to {MODELS[step.escalation.to].label}. {step.escalation.reason}
          </p>
        )}
        <Work step={step} showPlan={showPlan} />
      </div>
    </li>
  );
}

const READS = new Set(["read_file", "list_files", "search"]);
const EDITS = new Set(["write_file", "replace_in_file"]);

function Work({ step, showPlan }: { step: StepView; showPlan: boolean }) {
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
        <Markdown className="text" text={output} />
      </Item>
    ),
    output && step.role === "plan" && step.name === "plan" && (
      <Item key="out" icon={ICONS.note} summary="The plan" open={showPlan}>
        <Markdown className="text" text={output} />
      </Item>
    ),
    output &&
      step.role === "review" &&
      (approves(output) ? (
        <Item key="out" icon={ICONS.note} summary="The review approved it">
          {reviewNotes(output) && <Markdown className="text" text={reviewNotes(output)} />}
        </Item>
      ) : (
        <Item key="out" icon={ICONS.note} summary="The review asked for fixes" open>
          <Markdown className="text" text={reviewNotes(output)} />
        </Item>
      )),
  ].filter(Boolean);

  const said = output && step.role === "build" ? output : null;
  if (items.length === 0 && !said) return null;
  return (
    <div className="work">
      {said && <Markdown className="say" text={said} />}
      {items}
    </div>
  );
}

function Checks({ checks }: { checks: CheckResult[] }) {
  return (
    <Item icon={ICONS.term} summary={checksText(checks)}>
      <pre className="tout">
        {checks.map((c) => (
          <span key={c.command}>
            <b>
              <i className={c.ok ? "good" : "bad"}>{c.ok ? "✓" : "✗"}</i> {c.command}
              {c.failedBefore && <span className="was"> · failed before the change too</span>}
              {c.newFailures && (
                <span className="was"> · failed before the change too, with {count(c.newFailures.length, "new failure")}</span>
              )}
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
    text = result.reason
      ? `Ready to accept. ${result.reason}`
      : result.checks.length
        ? "Ready to accept. The checks pass and the review approved the change."
        : "Ready to accept. The review approved the change. This project has no checks to run.";
  else if (result.status === "needs-work")
    text =
      result.reason ??
      "The review found problems, listed above. Fix it has Shoji work through them. You can also ask for changes of your own, or accept the work as it is.";
  else if (result.status === "planned")
    text = "Here's the plan. Build it as it is, or say what to change first. Nothing in the project has changed yet.";
  else if (result.status === "stopped")
    text =
      "Shoji stopped before the next step could take this thread past its limit. Keep going gives it more to spend, or you can accept the work as it is.";
  else text = result.reason ?? STATUS[result.status];
  return <p className={result?.status === "ready" ? "outcome" : "outcome warn"}>{text}</p>;
}

/** Ctrl+1 and Ctrl+2 (⌘ on a Mac) switch between Conversation and Code. */
function useModeKeys(setMode: (mode: "conversation" | "code") => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === "1") setMode("conversation");
      else if (e.key === "2") setMode("code");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);
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

/** How the checks came out, in words: new failures first, then ones that failed before the change too. */
function checksText(checks: CheckResult[]): string {
  const failed = checks.filter((c) => !c.ok && !c.failedBefore).length;
  const before = checks.filter((c) => c.failedBefore).length;
  if (failed) return `${failed} of ${count(checks.length, "check")} failed`;
  if (before === checks.length) return `${count(before, "check")} failing, as before`;
  if (before) return `${count(checks.length - before, "check")} passed, ${before} failing as before`;
  return `${count(checks.length, "check")} passed`;
}

function checksSummary(checks: CheckResult[] | undefined): ReactNode {
  if (!checks?.length) return null;
  const failed = checks.some((c) => !c.ok && !c.failedBefore);
  const before = checks.some((c) => c.failedBefore);
  return <span className={failed ? "bad" : before ? undefined : "good"}>{checksText(checks)}</span>;
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
