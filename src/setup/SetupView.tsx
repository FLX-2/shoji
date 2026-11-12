import { useEffect, useState, type ReactNode } from "react";
import { MODELS, providerOf } from "../../runtime/src/models";
import { chargesNothing } from "../receipts/receipts";
import { STACKS, type Stack, type StackName } from "../../runtime/src/stack";
import type { Bridge, FoundProject, KeyStatus } from "../bridge";
import { folderName } from "../home/HomeView";
import { MoneyRow } from "../settings/MoneyRow";
import type { Prefs } from "../settings/prefs";
import { Mark } from "../shell/Mark";
import { describeStack, presetOf, PRESETS, sameStack } from "../stack/lock";
import type { ChatGPT } from "../stack/chatgpt";
import type { Ollama } from "../stack/ollama";
import type { OpenRouter } from "../stack/openrouter";
import type { Gemini } from "../stack/gemini";
import { providerPresets, type ProviderPreset } from "../stack/presets";
import { ChatGPTRow } from "../settings/ChatGPTRow";
import { OllamaRow } from "../settings/OllamaRow";
import { OpenRouterRow } from "../settings/OpenRouterRow";
import { GeminiRow } from "../settings/GeminiRow";
import { formatCost } from "../thread/fold";
import { NOTES_CAP, notesProgress, type Notes } from "./useNotes";

interface SetupViewProps {
  bridge: Bridge;
  keyStatus: KeyStatus | null;
  /** Reads the key's status again after it changes. */
  onKeyChanged: () => Promise<void>;
  ollama: Ollama;
  chatgpt: ChatGPT;
  openrouter: OpenRouter;
  gemini: Gemini;
  stack: Stack;
  onSaveStack: (stack: Stack) => Promise<void>;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  /** The project notes Scout is writing or last wrote, if any. */
  notes: Notes | null;
  /** Starts Scout on the project's notes, on the stack picked here. */
  onWriteNotes: (repo: string, stack: Stack) => void;
  onDone: () => void;
}

/** The first run, on one page: connect a model provider, take a starting stack and open a project. Look isn't
 *  here: its defaults are calm, and Settings has it for later. */
export function SetupView(props: SetupViewProps) {
  const [choice, setChoice] = useState(props.stack);
  const anthropic = !!props.keyStatus?.saved;
  const free = props.prefs.geminiTier === "free";
  // Only the stacks that can run on what's connected; OpenAI's key isn't asked for here.
  const presets = providerPresets({
    anthropic,
    openai: false,
    chatgpt: props.chatgpt,
    ollama: props.ollama,
    openrouterFree: props.openrouter.free,
    gemini: free ? { free: props.gemini.models } : { paid: props.gemini.models },
  });
  const connected = anthropic || presets.length > 0;
  const names = [
    anthropic && "Anthropic",
    props.chatgpt.status === "signed-in" && "ChatGPT",
    props.ollama.status === "ready" && "Ollama",
    props.openrouter.status === "connected" && "OpenRouter",
    props.gemini.status === "connected" && "Gemini",
  ].filter(Boolean) as string[];

  // Without Anthropic, the stack starts on whichever other stack can run.
  const runs = presets.some((p) => sameStack(choice, p.stack));
  const picked = anthropic || runs ? choice : (presets[0]?.stack ?? choice);

  const start = async () => {
    if (!sameStack(picked, props.stack)) await props.onSaveStack(picked);
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
          openrouter={props.openrouter}
          gemini={props.gemini}
          prefs={props.prefs}
          onChange={props.onChange}
        />
        <StackStep
          choice={picked}
          onChoose={setChoice}
          anthropic={anthropic}
          presets={presets}
          prefs={props.prefs}
          onChange={props.onChange}
        />
        <Project
          bridge={props.bridge}
          repo={props.prefs.repo}
          starters={props.prefs.starters}
          onChange={props.onChange}
          scout={MODELS[picked.scout.model].label}
          free={chargesNothing(picked.scout.model)}
          notes={props.notes}
          onWriteNotes={(repo) => props.onWriteNotes(repo, picked)}
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
  openrouter,
  gemini,
  prefs,
  onChange,
}: {
  bridge: Bridge;
  status: KeyStatus | null;
  onKeyChanged: () => Promise<void>;
  ollama: Ollama;
  chatgpt: ChatGPT;
  openrouter: OpenRouter;
  gemini: Gemini;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
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
          Connect any of them. You can start free: ChatGPT runs on your Plus or Pro plan, Ollama runs models on this
          computer, and OpenRouter and Gemini have free models with daily limits. Keys stay in your system keychain.
          You can change these later in Settings.
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
        <OpenRouterRow openrouter={openrouter} />
        <GeminiRow gemini={gemini} tier={prefs.geminiTier} onTier={(geminiTier) => onChange({ geminiTier })} />
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
  presets,
  prefs,
  onChange,
}: {
  choice: Stack;
  onChoose: (stack: Stack) => void;
  /** Whether Anthropic is connected, so its stacks can run. */
  anthropic: boolean;
  /** The stacks other connected providers can run. */
  presets: ProviderPreset[];
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
        {presets.map((p) => (
          <button
            key={p.name}
            type="button"
            role="radio"
            aria-checked={!preset && sameStack(choice, p.stack)}
            onClick={() => onChoose(p.stack)}
          >
            {p.name}
          </button>
        ))}
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
          description="Shoji asks before a thread or trial could take the day's spend past this. Start small and raise it when you're ready."
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
  starters,
  onChange,
  scout,
  free,
  notes,
  onWriteNotes,
}: {
  bridge: Bridge;
  repo: string | null;
  /** First tasks offered on Home, by project folder. */
  starters: Record<string, string[]>;
  onChange: (change: Partial<Prefs>) => void;
  /** The Scout seat's model, which reads the project for its notes. */
  scout: string;
  /** Whether that model costs nothing: it runs on this computer or on a plan. */
  free: boolean;
  notes: Notes | null;
  onWriteNotes: (repo: string) => void;
}) {
  const [recent, setRecent] = useState<string[]>([]);
  const [found, setFound] = useState<FoundProject[]>([]);
  const [check, setCheck] = useState<Check>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);

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
      <div className="acts">
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
        <button
          type="button"
          className="btn sm"
          title="A small project with failing tests, so a first task never touches your own code"
          onClick={async () => {
            try {
              const [path, task] = await bridge.practiceProject();
              onChange({ repo: path, starters: { ...starters, [path]: [task] } });
              setPracticeError(null);
            } catch (e) {
              setPracticeError(String(e).replace(/^Error: /, ""));
            }
          }}
        >
          Use a practice project
        </button>
      </div>
      {practiceError && <p className="note">{practiceError}</p>}
      {repo && check?.repo === repo && !check.notGit && (
        <NotesRow
          repo={repo}
          scout={scout}
          free={free}
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
  free,
  notes,
  onWrite,
}: {
  repo: string;
  scout: string;
  free: boolean;
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
    description = `Written to SHOJI.md${free ? "" : ` for ${formatCost(result.cost)}`}. Edit it any time. Git ignores it, so it stays out of your commits.`;
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
      `${scout} reads the project once and writes SHOJI.md: its commands and conventions. Plan reads it before every task.${free ? "" : ` It stops at $${NOTES_CAP.toFixed(2)}.`}`;
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
