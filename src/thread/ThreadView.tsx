import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ComparedPage } from "../../runtime/src/compare";
import type { CheckResult } from "../../runtime/src/events";
import { MODELS } from "../../runtime/src/models";
import type { Bridge, Pushed } from "../bridge";
import { CodeView } from "../code/CodeView";
import { commentsNote, type LineComment } from "../code/comments";
import { useChanges } from "../code/useChanges";
import { ClipIcon } from "../shell/ClipIcon";
import { ROLE_NAMES } from "../stack/lock";
import { Composer } from "../shell/Composer";
import { Working } from "../shell/Mark";
import type { SlashCommand } from "../shell/mention";
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
import { PreviewView } from "./PreviewView";
import type { useTerminals } from "./useTerminals";
import { serverRunning, type Server } from "./useServers";
import { fileName, isRunning, threadCost, type Thread, type Turn } from "./useThread";

type Terminals = ReturnType<typeof useTerminals>;

// The terminal brings xterm with it, so it loads the first time a terminal opens.
const TerminalView = lazy(() => import("./TerminalView").then((m) => ({ default: m.TerminalView })));

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
  /** Asks about the work; the answer changes nothing. */
  onQuestion: (question: string) => void;
  onCommit: () => Promise<void>;
  /** Pushes the committed branch and opens the page for a pull request. Only the person's button does. */
  onPush: () => Promise<Pushed>;
  /** The person's answer about a command the run wants; `always` allows it in this project from now on. */
  onAnswer: (command: string, allow: boolean, always: boolean) => Promise<void>;
  /** What the thread has cost, on the review bar. Off in Settings hides it. */
  showCosts: boolean;
  /** Where the project's dev server answers, for Preview. */
  previewUrl: string;
  /** The dev server Shoji started in this thread's copy, if it did. */
  server?: Server;
  /** The command that starts the project's dev server. */
  devCommand: string;
  onStartServer: (dir: string, command: string) => void;
  onStopServer: (dir: string) => void;
  /** The terminals Shoji opened, one for each thread's copy. */
  terminals: Terminals;
  /** Motion is off. */
  still: boolean;
  onPreviewUrl: (url: string) => void;
  /** The side panel opens by itself when Shoji edits a file or looks at a page, or a preview starts. */
  autoPanel: boolean;
}

/** The side panel's tabs. */
type Pane = "code" | "preview" | "terminal";

/** The side panel beside the conversation: whether it's open, and the tab it shows, kept while it's closed. */
interface Panel {
  open: boolean;
  tab: Pane;
}

const PANES: { id: Pane; label: string; key: string }[] = [
  { id: "code", label: "Code", key: "2" },
  { id: "preview", label: "Preview", key: "3" },
  { id: "terminal", label: "Terminal", key: "4" },
];

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const SHORTCUT = MAC ? "⌘" : "Ctrl+";

const STATUS = {
  ready: "Ready to accept",
  "needs-work": "Needs work",
  stopped: "Stopped",
  failed: "Failed",
  planned: "Plan ready",
  answered: "Answered",
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
  onQuestion,
  onCommit,
  onPush,
  onAnswer,
  showCosts,
  previewUrl,
  onPreviewUrl,
  server,
  devCommand,
  onStartServer,
  onStopServer,
  terminals,
  still,
  autoPanel,
}: ThreadViewProps) {
  const last = thread.turns[thread.turns.length - 1];
  const running = isRunning(last);
  const runs = thread.turns.map((turn) => foldRun(turn.events));
  const lastRun = runs[runs.length - 1];
  // A question changes nothing, so where the thread stands comes from the last run that did the work.
  const workAt = thread.turns.findLastIndex((t) => t.kind !== "question");
  const lastWork = workAt < 0 ? lastRun : runs[workAt];
  const workTurn = workAt < 0 ? last : thread.turns[workAt];
  const spent = threadCost(thread);
  // Where the thread's work is: its own copy of the project, or the project itself for an older thread. Once
  // the work is committed the copy is put away, and its branch holds the work.
  const place = thread.workdir ?? thread.repo;
  const putAway = !!thread.workdir && !!thread.committed;
  // Where Preview's dev server and the terminal run: the thread's copy, or the project once the copy is put away.
  const here = putAway ? thread.repo : place;
  // Kept the same between draws, since the terminal is made again when they change.
  const { history: historyIn, follow: followIn } = terminals;
  const termHistory = useCallback(() => historyIn(here), [historyIn, here]);
  const termFollow = useCallback((listen: (data: string) => void) => followIn(here, listen), [followIn, here]);
  // The composer stays under the conversation: it takes changes to the work or a question about it, and
  // while a run works it holds what's next and Stop.
  const [say, setSay] = useState<"changes" | "question">("changes");
  const talkable = !thread.committed && runs.some((run) => run.result?.plan);
  const talking = running || talkable;
  // The project's files and commands, for @ and / in the composer.
  const [files, setFiles] = useState<string[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    if (!talking) return;
    let current = true;
    bridge.projectFiles(putAway ? thread.repo : place).then(
      (list) => current && setFiles(list),
      () => {},
    );
    bridge.projectCommands(putAway ? thread.repo : place).then(
      (list) => current && setCommands(list),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [talking, bridge, place, putAway, thread.repo]);
  const scroller = useFollow(thread);
  // The side panel with Code, Preview and Terminal. It opens on Code until another tab is picked.
  const [panel, setPanel] = useState<Panel>({ open: false, tab: "code" });
  // The turn in which the person last closed the panel: until the next turn, it doesn't open by itself.
  const closedIn = useRef(-1);
  const turnCount = thread.turns.length;
  const changePanel = useCallback(
    (change: SetStateAction<Panel>) =>
      setPanel((now) => {
        const next = typeof change === "function" ? change(now) : change;
        if (now.open && !next.open) closedIn.current = turnCount;
        return next;
      }),
    [turnCount],
  );
  usePanelKeys(changePanel);
  // Held here so the chosen file outlives closing Code.
  const [chosenFile, setChosenFile] = useState<string | null>(null);
  const openFile = (path: string) => {
    setChosenFile(path);
    changePanel({ open: true, tab: "code" });
  };
  // What the run working now has edited and looked at, for the panel to follow.
  const liveTools = running ? lastRun.steps.flatMap((s) => s.tools) : [];
  const liveEdits = liveTools.filter((t) => EDITS.has(t.tool)).map((t) => t.target);
  const liveLooks = liveTools.filter((t) => t.tool === "look_at_page").length;
  // Opens by itself only while closed, so a tab the person is looking at is never pulled away, and not again
  // in a turn where they closed it.
  const follow = (tab: Pane, file?: string) => {
    if (!autoPanel || panel.open || closedIn.current === turnCount) return;
    if (file) setChosenFile(file);
    setPanel({ open: true, tab });
  };
  useOnRise(liveEdits.length, () => follow("code", liveEdits[liveEdits.length - 1]));
  useOnRise(liveLooks, () => follow("preview"));
  // The before and after a run made of the pages it changed: the last work's, unless the person opened an
  // earlier turn's. A new turn starts from the last work again.
  const [compareAsk, setCompareAsk] = useState<{ turn: number; page: number; at: number } | null>(null);
  useEffect(() => setCompareAsk(null), [turnCount]);
  const compareRun = runs[compareAsk?.turn ?? workAt];
  const compare =
    compareRun?.compare && !compareRun.compare.running && compareRun.compare.pages.length
      ? compareRun.compare
      : undefined;
  const openCompare = (turn: number, page: number) => {
    setCompareAsk({ turn, page, at: Date.now() });
    changePanel({ open: true, tab: "preview" });
  };
  // A comparison that just arrived shows by itself, on Preview: opening the panel when it's closed, or in it
  // when it's already on Preview. Another tab is left alone.
  const compared = running && lastRun.compare && !lastRun.compare.running ? lastRun.compare.pages.length : 0;
  useOnRise(compared, () => {
    if (!autoPanel || closedIn.current === turnCount || (panel.open && panel.tab !== "preview")) return;
    setCompareAsk({ turn: turnCount - 1, page: 0, at: Date.now() });
    setPanel({ open: true, tab: "preview" });
  });
  // A preview starting is something the person asked for, so it shows even over another tab.
  useOnRise(server?.url && serverRunning(server) ? 1 : 0, () => autoPanel && setPanel({ open: true, tab: "preview" }));
  // Read the project again whenever a run ends or edits a file, or Code opens.
  const ended = thread.turns.filter((t) => t.exit || t.error).length;
  const codeOpen = panel.open && panel.tab === "code";
  const { changes, error, act } = useChanges(
    bridge,
    putAway ? null : place,
    `${ended}-${liveEdits.length}-${codeOpen}-${thread.committed}`,
  );
  const fileCount = changes?.files.length ?? 0;
  // Comments on lines of the diff, kept across views until they go to Build.
  const [comments, setComments] = useState<LineComment[]>([]);
  useEffect(() => setComments([]), [thread.id]);
  const [committing, setCommitting] = useState(false);
  const [push, setPush] = useState<{ pushing: true } | { done: Pushed } | { error: string } | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Stopped at its limit, so the way on is more to spend.
  const stopped = lastWork.result?.status === "stopped";
  // Paused after the plan, for the person to build it or ask for a different one.
  const planned = lastWork.result?.status === "planned";
  // The review sent it back. Fixing can't help a check whose program isn't on this computer.
  const fixable = lastWork.result?.status === "needs-work" && !lastWork.result.checks.some((c) => c.missing);
  // The work can take changes: it has a plan, isn't committed, and has money left.
  const canChange = !running && !thread.committed && runs.some((run) => run.result?.plan) && spent < thread.cap;
  const outcome = running
    ? undefined
    : lastWork.result
      ? lastWork.result.status
      : workTurn.stoppedByYou
        ? "stopped"
        : "failed";

  const commit = () => {
    setCommitting(true);
    setCommitError(null);
    onCommit()
      .catch((e) => setCommitError(String(e)))
      .finally(() => setCommitting(false));
  };

  const pushBranch = () => {
    setPush({ pushing: true });
    onPush().then(
      (done) => setPush({ done }),
      (e) => setPush({ error: String(e) }),
    );
  };

  const now = lastRun.steps.findLast((s) => s.running);
  const stage = running ? (
    lastRun.asking ? (
      "Waiting for you"
    ) : lastRun.compare?.running ? (
      "Comparing the pages before and after"
    ) : now ? (
      <>
        {stepLabel(lastRun.steps, lastRun.steps.indexOf(now))}
        <span className="mn"> · {MODELS[now.model].label}</span>
      </>
    ) : last.stoppedByYou ? (
      "Stopping"
    ) : lastRun.result ? (
      STATUS[lastRun.result.status]
    ) : (
      "Starting"
    )
  ) : lastWork.result ? (
    STATUS[lastWork.result.status]
  ) : workTurn.stoppedByYou ? (
    STATUS.stopped
  ) : (
    STATUS.failed
  );

  return (
    <section className="thread">
      <div className="convo">
        <div className="tbar solid">
          <h1>{thread.task.split("\n")[0]}</h1>
          <span className="stage" data-outcome={outcome}>
            <span className="dot live" aria-hidden="true" />
            {stage}
          </span>
        </div>
        <div className="scroll" ref={scroller}>
          <div className="tcol">
            {thread.turns.map((turn, i) => (
              <TurnView
                key={i}
                turn={turn}
                run={runs[i]}
                live={running && i === thread.turns.length - 1}
                waiting={planned && i === thread.turns.length - 1}
                onOpenFile={openFile}
                onCompare={(page) => openCompare(i, page)}
              />
            ))}
          </div>
        </div>

        {running && lastRun.asking && (
          <CommandAsk
            key={lastRun.asking}
            command={lastRun.asking}
            tool={!!lastRun.askingTool}
            step={now ? ROLE_NAMES[now.role].label : undefined}
            project={fileName(thread.repo)}
            onAnswer={(allow, always) => onAnswer(lastRun.asking!, allow, always)}
          />
        )}

        {!running &&
          (planned ? (
            <div className="review">
              <button type="button" className="btn solid" onClick={onBuild}>
                Build it
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
                <>
                  {thread.branch && (
                    <button
                      type="button"
                      className={push && "done" in push ? "btn" : "btn solid"}
                      onClick={pushBranch}
                      disabled={!!push && "pushing" in push}
                    >
                      {push && "pushing" in push ? "Pushing…" : "Push and open PR"}
                    </button>
                  )}
                  <span className="done">
                    {push && "done" in push ? (
                      <>
                        Pushed {thread.branch} to {push.done.remote}
                        {!push.done.url && ". Open a pull request for it on your git host"}
                      </>
                    ) : (
                      <>
                        Committed <b>{thread.committed}</b> on {thread.branch}
                      </>
                    )}
                  </span>
                  {push && "error" in push && <span className="err">{push.error}</span>}
                </>
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
                  !thread.committed && checksSummary(lastWork.result?.checks),
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

        {talking && (
          <Composer
            key={thread.id ?? "new"}
            label={running ? "What's next" : say === "question" ? "Question" : planned ? "Plan changes" : "Changes"}
            placeholder={
              running
                ? "Shoji is working. Write what's next, and send it when this run ends."
                : say === "question"
                  ? "Ask about this work. Nothing will change."
                  : planned
                    ? "What should the plan do differently?"
                    : "Describe the changes you want…"
            }
            blocked={spent >= thread.cap}
            onSend={(notes) => (say === "question" ? onQuestion : planned ? onReplan : onRequestChanges)(notes)}
            files={files}
            commands={commands}
            {...(running && { onStop, stopping: last.stoppedByYou })}
          >
            {!running && (
              <div className="seg" role="radiogroup" aria-label="What to send">
                <button type="button" role="radio" aria-checked={say === "changes"} onClick={() => setSay("changes")}>
                  {planned ? "Change the plan" : "Request changes"}
                </button>
                <button type="button" role="radio" aria-checked={say === "question"} onClick={() => setSay("question")}>
                  Ask a question
                </button>
              </div>
            )}
          </Composer>
        )}
      </div>
      <button
        type="button"
        className="ptoggle"
        aria-label="Side panel"
        aria-pressed={panel.open}
        aria-controls="side-panel"
        title={
          panel.open
            ? `Close the side panel (${SHORTCUT}1)`
            : `Open the side panel: Code, Preview and Terminal (${SHORTCUT}2 to 4)`
        }
        onClick={() => changePanel((now) => ({ ...now, open: !now.open }))}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M10 3v10" />
        </svg>
      </button>
      {panel.open && (
        <aside className="tpane" id="side-panel" aria-label="Side panel">
          <div className="tph solid">
            <div className="seg" role="tablist" aria-label="Side panel">
              {PANES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={panel.tab === p.id}
                  aria-controls="side-panel-view"
                  title={`${p.label} (${SHORTCUT}${p.key})`}
                  onClick={() => changePanel({ open: true, tab: p.id })}
                >
                  {p.label}
                  {p.id === "code" && fileCount > 0 && <span className="cnt">{count(fileCount, "file")}</span>}
                </button>
              ))}
            </div>
          </div>
          <div
            className="tpv"
            role="tabpanel"
            id="side-panel-view"
            aria-label={PANES.find((p) => p.id === panel.tab)!.label}
          >
            {panel.tab === "code" && (
              <CodeView
                changes={changes}
                error={error}
                running={running}
                chosen={chosenFile}
                onChoose={setChosenFile}
                onAccept={(path) => act(bridge.acceptFile(place, path))}
                onRevert={(path) => act(bridge.revertFile(place, path))}
                onRead={(path) => bridge.readFile(place, path)}
                {...(!thread.committed && {
                  onSave: (path: string, text: string) => act(bridge.writeFile(place, path, text)),
                })}
                comments={comments}
                {...(canChange && { onComments: setComments })}
                onSendComments={() => {
                  onRequestChanges(commentsNote(comments));
                  setComments([]);
                }}
              />
            )}

            {panel.tab === "terminal" && (
              <Suspense fallback={<div className="terminal" />}>
                <TerminalView
                  session={terminals.sessions[here]}
                  history={termHistory}
                  follow={termFollow}
                  onOpen={(cols, rows) => terminals.open(here, cols, rows)}
                  onInput={(data) => terminals.write(here, data)}
                  onResize={(cols, rows) => terminals.resize(here, cols, rows)}
                  still={still}
                />
              </Suspense>
            )}
            {panel.tab === "preview" && (
              <PreviewView
                url={previewUrl}
                onUrl={onPreviewUrl}
                freshness={String(ended)}
                server={server}
                command={devCommand}
                onStartServer={(command) => onStartServer(here, command)}
                onStopServer={() => onStopServer(here)}
                compare={compare}
                compareAsk={compareAsk}
                readShot={bridge.readShot}
              />
            )}
          </div>
        </aside>
      )}
    </section>
  );
}

/** A run waiting for the person to allow a command beyond the project's checks. */
function CommandAsk({
  command,
  tool,
  step,
  project,
  onAnswer,
}: {
  command: string;
  /** It's an MCP tool that may change something, rather than a command. */
  tool: boolean;
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
    <div className="review cmdask" role="alertdialog" aria-label={tool ? "Allow this tool?" : "Allow this command?"}>
      {tool ? (
        <p>
          {step ?? "Shoji"} wants to use <code>{command}</code> from an MCP server. Tools that only look run on their
          own; anything that could change something waits for you.
        </p>
      ) : (
        <p>
          {step ?? "Shoji"} wants to run <code>{command}</code>. Checks run on their own; anything else waits for you.
        </p>
      )}
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
function TurnView({
  turn,
  run,
  live,
  waiting,
  onOpenFile,
  onCompare,
}: {
  turn: Turn;
  run: RunView;
  live: boolean;
  waiting: boolean;
  /** Opens the side panel on Code, at this file. */
  onOpenFile: (path: string) => void;
  /** Opens the side panel on Preview, comparing this run's page before and after. */
  onCompare: (page: number) => void;
}) {
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
                <StepRow key={i} steps={run.steps} index={i} live={live} showPlan={waiting} onOpenFile={onOpenFile} />
              ))}
              {run.compare && (live || !run.compare.running) && (
                <CompareRow compare={run.compare} live={live} onCompare={onCompare} />
              )}
            </ol>
          )}
          {run.unreached?.map((u) => (
            <p key={u.server} className="esc">
              Couldn't reach the {u.server} MCP server, so this run went on without it. {u.error}
            </p>
          ))}
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
  onOpenFile,
}: {
  steps: StepView[];
  index: number;
  live: boolean;
  showPlan: boolean;
  onOpenFile: (path: string) => void;
}) {
  const step = steps[index];
  const now = live && step.running;
  const finished = !step.running && !step.unfinished;
  return (
    <li className={now ? "st now" : finished ? "st done" : "st"}>
      <span className="c" aria-hidden="true">
        {now && <Working />}
        {finished && (
          <svg className="tick" viewBox="0 0 12 12">
            <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        )}
      </span>
      <div className="sb">
        <div className="sl">
          {stepLabel(steps, index)}
          <span
            className="m mn"
            title={step.cost > 0 ? `${MODELS[step.model].label} · ${formatCost(step.cost)}` : MODELS[step.model].label}
          >
            {modelName(step.model)}
          </span>
        </div>
        {step.escalation && (
          <p className="esc">
            Moved up to {MODELS[step.escalation.to].label}. {step.escalation.reason}
          </p>
        )}
        <Work step={step} showPlan={showPlan} onOpenFile={onOpenFile} />
      </div>
    </li>
  );
}

/** The step after the work: the pages Build looked at, before and after, which calls no model. */
function CompareRow({
  compare,
  live,
  onCompare,
}: {
  compare: NonNullable<RunView["compare"]>;
  live: boolean;
  onCompare: (page: number) => void;
}) {
  const now = live && compare.running;
  const widths = (page: ComparedPage) => listed(page.shots.filter((s) => s.before || s.after).map((s) => `${s.width}`));
  return (
    <li className={now ? "st now" : "st done"}>
      <span className="c" aria-hidden="true">
        {now ? (
          <Working />
        ) : (
          <svg className="tick" viewBox="0 0 12 12">
            <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        )}
      </span>
      <div className="sb">
        <div className="sl">{now ? "Comparing the pages before and after" : "Compared the pages before and after"}</div>
        {compare.problem && <p className="esc">{compare.problem}</p>}
        {!now && compare.pages.some((p) => widths(p)) && (
          <div className="work">
            {compare.pages.map(
              (page, i) =>
                widths(page) && (
                  <button key={page.path} type="button" className="wk wkbtn" onClick={() => onCompare(i)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={ICONS.compare} />
                    </svg>
                    <span>
                      {page.path} at {widths(page)} px
                    </span>
                    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                ),
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** "360", "360 and 768", "360, 768 and 1280". */
function listed(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
}

const READS = new Set(["read_file", "list_files", "search"]);
const EDITS = new Set(["write_file", "replace_in_file"]);

function Work({
  step,
  showPlan,
  onOpenFile,
}: {
  step: StepView;
  showPlan: boolean;
  onOpenFile: (path: string) => void;
}) {
  const reads = step.tools.filter((t) => READS.has(t.tool));
  const edits = unique(step.tools.filter((t) => EDITS.has(t.tool)).map((t) => t.target));
  const commands = step.tools.filter((t) => t.tool === "run_command").map((t) => t.target);
  // MCP tools come named as "server: tool".
  const used = step.tools.filter((t) => t.tool.startsWith("mcp__")).map((t) => t.target);
  const skills = unique(step.tools.filter((t) => t.tool === "read_skill").map((t) => t.target));
  // Pages seen in the headless browser, as "/pricing at 360px".
  const looks = step.tools.filter((t) => t.tool === "look_at_page").map((t) => t.target);
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
            <li key={path}>
              <button type="button" className="open" title="Open in Code" onClick={() => onOpenFile(path)}>
                {path}
              </button>
            </li>
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
    used.length > 0 && (
      <Item key="mcp" icon={ICONS.term} summary={listSummary("Used", unique(used))}>
        <ul className="files">
          {used.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </Item>
    ),
    looks.length > 0 && (
      <Item
        key="looks"
        icon={ICONS.file}
        summary={`Looked at ${looks[0]}${looks.length > 1 ? ` and ${looks.length - 1} more` : ""}`}
      >
        <ul className="files">
          {looks.map((page, i) => (
            <li key={i}>{page}</li>
          ))}
        </ul>
      </Item>
    ),
    skills.length > 0 && (
      <Item
        key="skills"
        icon={ICONS.note}
        summary={`Used the ${skills[0]} skill${skills.length > 1 ? ` and ${skills.length - 1} more` : ""}`}
      >
        <ul className="files">
          {skills.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </Item>
    ),
    step.checks && step.checks.length > 0 && <Checks key="checks" checks={step.checks} />,
    output && step.role === "scout" && step.name !== "answer" && (
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

  const said = output && (step.role === "build" || step.name === "answer") ? output : null;
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
                <span className="was">
                  {" "}
                  · failed before the change too, with {count(c.newFailures.length, "new failure")}
                </span>
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
  if (live || run.result?.status === "answered") return null;
  const result = run.result;
  let text: string;
  if (turn.error) text = turn.error;
  else if (!result)
    text = turn.stoppedByYou ? "You stopped this thread." : turn.exit?.error || "The runtime quit before it finished.";
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

/** Ctrl+2, Ctrl+3 and Ctrl+4 (⌘ on a Mac) open the side panel on Code, Preview or Terminal, or close it when
 *  it already shows that tab; Ctrl+1 closes it. */
function usePanelKeys(setPanel: (change: SetStateAction<Panel>) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      const tab = PANES.find((p) => p.key === e.key)?.id;
      if (e.key === "1") setPanel((now) => ({ ...now, open: false }));
      else if (tab) setPanel((now) => (now.open && now.tab === tab ? { ...now, open: false } : { open: true, tab }));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPanel]);
}

/** Calls `onRise` after a draw in which `value` went up. */
function useOnRise(value: number, onRise: () => void) {
  const last = useRef(value);
  useEffect(() => {
    if (value > last.current) onRise();
    last.current = value;
  });
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
  compare: "M4 5h16v14H4zM12 3v18",
};
