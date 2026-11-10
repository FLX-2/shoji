import { useEffect, useState, type ReactNode } from "react";
import { MODELS, providerOf } from "../../runtime/src/models";
import { STACKS, type Stack, type StackName } from "../../runtime/src/stack";
import type { Bridge, FoundProject, KeyStatus } from "../bridge";
import { folderName } from "../home/HomeView";
import { MoneyRow } from "../settings/MoneyRow";
import type { Prefs } from "../settings/prefs";
import { Mark } from "../shell/Mark";
import { describeStack, presetOf, PRESETS, sameStack } from "../stack/lock";
import { planStack, type ChatGPT } from "../stack/chatgpt";
import { localStack, type Ollama } from "../stack/ollama";
import { ChatGPTRow } from "../settings/ChatGPTRow";
import { OllamaRow } from "../settings/OllamaRow";
import { formatCost } from "../thread/fold";
import { NOTES_CAP, notesProgress, type Notes } from "./useNotes";

interface SetupViewProps {
  bridge: Bridge;
  keyStatus: KeyStatus | null;
  /** Reads the key's status again after it changes. */
  onKeyChanged: () => Promise<void>;
  ollama: Ollama;
  chatgpt: ChatGPT;
  stack: Stack;
  onSaveStack: (stack: Stack) => Promise<void>;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  /** The project notes Scout is writing or last wrote, if any. */
  notes: Notes | null;
  onWriteNotes: (repo: string) => void;
  onDone: () => void;
}

/** The first run, on one page: connect a model provider, take a starting stack and open a project. Look isn't
 *  here: its defaults are calm, and Settings has it for later. */
export function SetupView(props: SetupViewProps) {
  const [choice, setChoice] = useState(props.stack);
  const anthropic = !!props.keyStatus?.saved;
  const local = props.ollama.status === "ready" ? localStack(props.ollama.models) : null;
  const plan =
    props.chatgpt.status === "signed-in" && props.chatgpt.models.length ? planStack(props.chatgpt.models) : null;
  const connected = anthropic || !!local || !!plan;
  const names = [anthropic && "Anthropic", plan && "ChatGPT", local && "Ollama"].filter(Boolean) as string[];

  // Without Anthropic, the stack starts on whichever other provider is connected, since only it can run.
  useEffect(() => {
    const other = plan ?? local;
    if (anthropic || !other) return;
    if (!sameStack(choice, other) && !(local && sameStack(choice, local))) setChoice(other);
  }, [anthropic, plan, local, choice]);

  const start = async () => {
    if (!sameStack(choice, props.stack)) await props.onSaveStack(choice);
    props.onDone();
  };

  return (
    <section className="setup" aria-label="Setup">
      <div className="su">
        <div className="suw">
          <Mark className="sumk" large />
          <h2>The right model for every step.</h2>
          <p>
            Shoji plans, builds and checks your work with a small team of models, each chosen for its step. You bring
            the models and pay the provider directly. Shoji itself is free.
          </p>
        </div>
        <Models bridge={props.bridge} status={props.keyStatus} onKeyChanged={props.onKeyChanged} ollama={props.ollama}
          chatgpt={props.chatgpt}
        />
        <StackStep
          choice={choice}
          onChoose={setChoice}
          anthropic={anthropic}
          plan={plan}
          local={local}
          prefs={props.prefs}
          onChange={props.onChange}
        />
        <Project
          bridge={props.bridge}
          repo={props.prefs.repo}
          onChange={props.onChange}
          scout={MODELS[props.stack.scout.model].label}
          notes={props.notes}
          onWriteNotes={props.onWriteNotes}
        />
        <div className="suf">
          <span className="note">{names.length ? `${and(names)} ${names.length > 1 ? "are" : "is"} connected` : "Connect a provider to start"}</span>
          <span className="sp" />
          <button type="button" className="btn solid" disabled={!connected} onClick={start}>
            Start using Shoji
          </button>
        </div>
      </div>
    </section>
  );
}

function Models({
  bridge,
  status,
  onKeyChanged,
  ollama,
  chatgpt,
}: {
  bridge: Bridge;
  status: KeyStatus | null;
  onKeyChanged: () => Promise<void>;
  ollama: Ollama;
  chatgpt: ChatGPT;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saved = !!status?.saved;
  const attempt = (work: Promise<void>) =>
    work.then(onKeyChanged).then(
      () => setError(null),
      (e) => setError(String(e)),
    );

  return (
    <section className="sup" aria-label="Models">
      <div className="suhd">
        <h3>Connect your models</h3>
        <p>
          Connect any of them. Your key stays in the system keychain and is sent only to Anthropic. ChatGPT runs on your
          Plus or Pro plan. Ollama runs models on this computer. You can change these later in Settings.
        </p>
      </div>
      {status?.fromEnv && !saved && (
        <div className="found">
          <div>
            <b>A key was found in your shell</b>
            <span className="d">
              In <code>SHOJI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code>. Shoji uses it only if you say so, and
              keeps it in your keychain from then on.
            </span>
          </div>
          <button type="button" className="btn sm solid" onClick={() => attempt(bridge.useShellKey())}>
            Use it
          </button>
        </div>
      )}
      <div className="card">
        <div className="srow">
          <div>
            <b>Anthropic</b>
            <span className="d">
              {error ??
                (saved
                  ? `${modelNames()}. Saved in your keychain.`
                  : `${modelNames()}. Paste a key from the Anthropic Console.`)}
            </span>
          </div>
          {saved ? (
            <span className="pill">
              <span className="dot ok" aria-hidden="true" />
              connected
            </span>
          ) : (
            <form
              className="keyform"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(bridge.saveKey(key).then(() => setKey("")));
              }}
            >
              <input
                type="password"
                aria-label="Anthropic API key"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button type="submit" className="btn sm" disabled={!key.trim()}>
                Connect
              </button>
            </form>
          )}
        </div>
        <ChatGPTRow chatgpt={chatgpt} onManageUsage={() => void bridge.chatgptManageUsage().catch(() => {})} setup />
        <OllamaRow ollama={ollama} setup />
      </div>
    </section>
  );
}

/** Anthropic's models, which its key reaches. */
function modelNames() {
  return Object.entries(MODELS)
    .filter(([id]) => providerOf(id) === "anthropic")
    .map(([, m]) => m.label)
    .join(", ");
}

function StackStep({
  choice,
  onChoose,
  anthropic,
  plan,
  local,
  prefs,
  onChange,
}: {
  choice: Stack;
  onChoose: (stack: Stack) => void;
  /** Whether Anthropic is connected, so its stacks can run. */
  anthropic: boolean;
  /** A stack on the person's ChatGPT plan, when they're signed in. */
  plan: Stack | null;
  /** A stack on Ollama's models, when Ollama has some. */
  local: Stack | null;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
}) {
  const preset = presetOf(choice);
  return (
    <section className="sup" aria-label="Stack">
      <div className="suhd">
        <h3>Your starting stack</h3>
        <p>
          Each step of a task goes to the model that does it best for the price. Shoji never switches a model without
          asking, and you can change any of them in Stack.
        </p>
      </div>
      <div className="seg" role="radiogroup" aria-label="Starting stack">
        {anthropic &&
          (Object.keys(STACKS) as StackName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={preset === name}
              onClick={() => onChoose(STACKS[name])}
            >
              {PRESETS[name]}
            </button>
          ))}
        {plan && (
          <button type="button" role="radio" aria-checked={sameStack(choice, plan)} onClick={() => onChoose(plan)}>
            On my ChatGPT plan
          </button>
        )}
        {local && (
          <button type="button" role="radio" aria-checked={sameStack(choice, local)} onClick={() => onChoose(local)}>
            On this computer
          </button>
        )}
      </div>
      <p className="note">{describeStack(choice)}</p>
      <div className="card">
        <MoneyRow
          id="su-cap"
          label="Limit per thread"
          description="Shoji stops a thread before any call that could take it past this."
          value={prefs.cap}
          onChange={(cap) => onChange({ cap })}
        />
        <MoneyRow
          id="su-daily"
          label="Daily limit"
          description="Shoji asks before a thread or trial could take the day's spend past this."
          value={prefs.dailyLimit}
          onChange={(dailyLimit) => onChange({ dailyLimit })}
        />
      </div>
    </section>
  );
}

type Check = { repo: string; problem: string | null; notGit?: boolean } | null;

function Project({
  bridge,
  repo,
  onChange,
  scout,
  notes,
  onWriteNotes,
}: {
  bridge: Bridge;
  repo: string | null;
  onChange: (change: Partial<Prefs>) => void;
  /** The Scout seat's model, which reads the project for its notes. */
  scout: string;
  notes: Notes | null;
  onWriteNotes: (repo: string) => void;
}) {
  const [recent, setRecent] = useState<string[]>([]);
  const [found, setFound] = useState<FoundProject[]>([]);
  const [check, setCheck] = useState<Check>(null);

  useEffect(() => {
    bridge
      .ledgerThreads()
      .then((threads) => setRecent([...new Set(threads.map((t) => t.repo))].slice(0, 4)))
      .catch(() => setRecent([]));
    bridge
      .foundProjects()
      .then(setFound)
      .catch(() => setFound([]));
  }, [bridge]);

  // Checks whichever project is chosen, including one chosen before setup.
  useEffect(() => {
    if (!repo) return;
    let current = true;
    bridge.changes(repo).then(
      (changes) =>
        current &&
        setCheck({
          repo,
          problem: changes.diff ? "It has uncommitted changes. Commit or stash them before the first task." : null,
        }),
      () =>
        current &&
        setCheck({
          repo,
          problem: "This folder isn't a git repository. Shoji works in git so every change can be reviewed and undone.",
          notGit: true,
        }),
    );
    return () => {
      current = false;
    };
  }, [bridge, repo]);

  const choose = (path: string) => onChange({ repo: path });

  // Shoji's own projects first, then those found in Claude Code and Codex, each once.
  const mine = repo && !recent.includes(repo) ? [repo, ...recent] : recent;
  const folders: { path: string; from?: string }[] = [
    ...mine.map((path) => ({ path })),
    ...found.filter((f) => !mine.includes(f.path)).map(({ path, from }) => ({ path, from })),
  ];
  return (
    <section className="sup" aria-label="Project">
      <div className="suhd">
        <h3>Open a project</h3>
        <p>
          Shoji works in a git repository on this computer. It commits only when you accept, and never pushes.
          {found.length > 0 && " Projects you worked on in Claude Code or Codex are listed too."}
        </p>
      </div>
      {folders.length > 0 && (
        <div className="card">
          {folders.map(({ path, from }) => (
            <button key={path} type="button" className="proj" aria-pressed={path === repo} onClick={() => choose(path)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h6l2 2h10v11H3z" />
              </svg>
              <span>
                <b>{folderName(path)}</b>
                <span className="d">{from ? `${from} · ${path}` : path}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {check && check.repo === repo && check.problem && <p className="note">{check.problem}</p>}
      <div>
        <button
          type="button"
          className="btn sm"
          onClick={async () => {
            const path = await bridge.pickProject();
            if (path) choose(path);
          }}
        >
          Open a folder…
        </button>
      </div>
      {repo && check?.repo === repo && !check.notGit && (
        <NotesRow
          repo={repo}
          scout={scout}
          notes={notes?.repo === repo ? notes : null}
          onWrite={() => onWriteNotes(repo)}
        />
      )}
    </section>
  );
}

/** Scout reads the project once and writes SHOJI.md, which Plan reads before every task. */
function NotesRow({
  repo,
  scout,
  notes,
  onWrite,
}: {
  repo: string;
  scout: string;
  notes: Notes | null;
  onWrite: () => void;
}) {
  const progress = notes && notesProgress(notes);
  const result = progress?.result;
  const failed =
    notes?.error ?? (result && result.status !== "ready" && result.status !== "kept" ? result.reason : null);
  const ended = notes?.exit && !result ? notes.exit.error || "Scout stopped before it finished." : null;

  let description: string;
  let action: ReactNode;
  if (notes?.kept || result?.status === "kept") {
    description = "This project already has a SHOJI.md. Plan reads it before every task.";
    action = <span className="pill">found</span>;
  } else if (result?.status === "ready") {
    description = `Written to SHOJI.md for ${formatCost(result.cost)}. Edit it any time. Git ignores it, so it stays out of your commits.`;
    action = (
      <span className="pill">
        <span className="dot ok" aria-hidden="true" />
        written
      </span>
    );
  } else if (progress?.running) {
    description = `${scout} is reading ${folderName(repo)}.`;
    action = (
      <span className="pill">
        <span className="dot live" aria-hidden="true" />
        reading
      </span>
    );
  } else {
    description =
      failed ??
      ended ??
      `${scout} reads the project once and writes SHOJI.md: its commands and conventions. Plan reads it before every task. It stops at $${NOTES_CAP.toFixed(2)}.`;
    action = (
      <button type="button" className="btn sm" onClick={onWrite}>
        {failed || ended ? "Try again" : "Write notes"}
      </button>
    );
  }

  return (
    <div className="card">
      <div className="srow">
        <div>
          <b>Project notes</b>
          <span className="d" role="status">
            {description}
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}

/** "Anthropic, ChatGPT and Ollama". */
function and(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
