import { useEffect, useState, type ReactNode } from "react";
import { MODELS } from "../../runtime/src/models";
import { ROLES, STACKS, type Stack, type StackName } from "../../runtime/src/stack";
import type { Bridge, KeyStatus } from "../bridge";
import { folderName } from "../home/HomeView";
import { AccentRow, BackgroundRow, MotionRow } from "../look/LookRows";
import { MoneyRow } from "../settings/MoneyRow";
import type { Prefs } from "../settings/prefs";
import { Mark } from "../shell/Mark";
import { describeStack, presetOf, PRESETS, ROLE_NAMES, sameStack, seatLabel } from "../stack/lock";
import { formatCost } from "../thread/fold";
import { NOTES_CAP, notesProgress, type Notes } from "./useNotes";

interface SetupViewProps {
  bridge: Bridge;
  keyStatus: KeyStatus | null;
  /** Reads the key's status again after it changes. */
  onKeyChanged: () => Promise<void>;
  stack: Stack;
  onSaveStack: (stack: Stack) => Promise<void>;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  /** The project notes Scout is writing or last wrote, if any. */
  notes: Notes | null;
  onWriteNotes: (repo: string) => void;
  onDone: () => void;
}

const STEPS = ["Models", "Stack", "Project", "Look"];

/** The first run: connect a model provider, take a starting stack, open a project and pick a look. */
export function SetupView(props: SetupViewProps) {
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState(props.stack);
  const connected = !!props.keyStatus?.saved;

  const next = async () => {
    if (step === 2 && !sameStack(choice, props.stack)) await props.onSaveStack(choice);
    setStep(step + 1);
  };

  return (
    <section className="setup" aria-label="Setup">
      <div className="su">
        {step > 0 && (
          <ol className="sust">
            {STEPS.map((name, i) => (
              <li key={name} className={i + 1 < step ? "done" : i + 1 === step ? "on" : undefined}>
                <i aria-hidden="true">{i + 1 < step ? "✓" : i + 1}</i>
                {name}
              </li>
            ))}
          </ol>
        )}

        {step === 0 && <Welcome onStart={() => setStep(1)} />}
        {step === 1 && <Models bridge={props.bridge} status={props.keyStatus} onKeyChanged={props.onKeyChanged} />}
        {step === 2 && <StackStep choice={choice} onChoose={setChoice} prefs={props.prefs} onChange={props.onChange} />}
        {step === 3 && (
          <Project
            bridge={props.bridge}
            repo={props.prefs.repo}
            onChange={props.onChange}
            scout={MODELS[props.stack.scout.model].label}
            notes={props.notes}
            onWriteNotes={props.onWriteNotes}
          />
        )}
        {step === 4 && <Look prefs={props.prefs} onChange={props.onChange} />}

        {step > 0 && (
          <div className="suf">
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
            <span className="sp" />
            {step === 1 && (
              <span className="note">{connected ? "Anthropic is connected" : "Connect Anthropic to go on"}</span>
            )}
            {step < 4 ? (
              <button type="button" className="btn solid" disabled={step === 1 && !connected} onClick={next}>
                Continue
              </button>
            ) : (
              <button type="button" className="btn solid" onClick={props.onDone}>
                Start using Shoji
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="sup">
      <div className="suw">
        <Mark className="sumk" large />
        <h2>The right model for every step.</h2>
        <p>
          Shoji plans, builds and checks your work with a small team of models, each chosen for its step. You bring the
          models and pay the provider directly. Shoji itself is free.
        </p>
      </div>
      <ol className="suplan">
        <li>
          <b>Connect models</b>
          <span>Your own Anthropic key</span>
        </li>
        <li>
          <b>Choose a starting stack</b>
          <span>Which model takes which step</span>
        </li>
        <li>
          <b>Open a project</b>
          <span>A git repository on this computer</span>
        </li>
      </ol>
      <div className="suf">
        <span className="note">About three minutes</span>
        <span className="sp" />
        <button type="button" className="btn solid" onClick={onStart}>
          Set up Shoji
        </button>
      </div>
    </div>
  );
}

function Models({
  bridge,
  status,
  onKeyChanged,
}: {
  bridge: Bridge;
  status: KeyStatus | null;
  onKeyChanged: () => Promise<void>;
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
    <div className="sup">
      <div className="suhd">
        <h2>Connect your models</h2>
        <p>Your key stays in the system keychain and is sent only to Anthropic. You can change it later in Settings.</p>
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
      </div>
    </div>
  );
}

function modelNames() {
  return Object.values(MODELS)
    .map((m) => m.label)
    .join(", ");
}

function StackStep({
  choice,
  onChoose,
  prefs,
  onChange,
}: {
  choice: Stack;
  onChoose: (stack: Stack) => void;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
}) {
  const preset = presetOf(choice);
  return (
    <div className="sup">
      <div className="suhd">
        <h2>Your starting stack</h2>
        <p>
          Each step of a task goes to the model that does it best for the price. Shoji never switches a model without
          asking, and you can change any of them in Stack.
        </p>
      </div>
      <div className="seg" role="radiogroup" aria-label="Starting stack">
        {(Object.keys(STACKS) as StackName[]).map((name) => (
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
      </div>
      <div className="card">
        {ROLES.map((role) => (
          <div key={role} className="srow">
            <div>
              <b>{ROLE_NAMES[role].label}</b>
              <span className="d">{ROLE_NAMES[role].does}</span>
            </div>
            <span className="mpick">{seatLabel(choice[role])}</span>
          </div>
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
          description="Shoji asks before a thread or trial could take the day's spend past this."
          value={prefs.dailyLimit}
          onChange={(dailyLimit) => onChange({ dailyLimit })}
        />
      </div>
    </div>
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
  const [check, setCheck] = useState<Check>(null);

  useEffect(() => {
    bridge
      .ledgerThreads()
      .then((threads) => setRecent([...new Set(threads.map((t) => t.repo))].slice(0, 4)))
      .catch(() => setRecent([]));
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

  const folders = repo && !recent.includes(repo) ? [repo, ...recent] : recent;
  return (
    <div className="sup">
      <div className="suhd">
        <h2>Open a project</h2>
        <p>Shoji works in a git repository on this computer. It commits only when you accept, and never pushes.</p>
      </div>
      {folders.length > 0 && (
        <div className="card">
          {folders.map((path) => (
            <button key={path} type="button" className="proj" aria-pressed={path === repo} onClick={() => choose(path)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h6l2 2h10v11H3z" />
              </svg>
              <span>
                <b>{folderName(path)}</b>
                <span className="d">{path}</span>
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
    </div>
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

function Look({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  return (
    <div className="sup">
      <div className="suhd">
        <h2>Make it yours</h2>
        <p>Changes apply as you pick. All of it can be changed later in Settings.</p>
      </div>
      <div className="card">
        <BackgroundRow prefs={prefs} onChange={onChange} />
        <MotionRow prefs={prefs} onChange={onChange} />
        <AccentRow prefs={prefs} onChange={onChange} />
      </div>
    </div>
  );
}
