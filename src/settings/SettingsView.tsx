import { useState } from "react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import type { Stack } from "../../runtime/src/stack";
import type { KeyStatus } from "../bridge";
import { AccentRow, BackgroundRow, DensityRow, FrostRow, MotionRow, OpaqueRow, SwitchRow } from "../look/LookRows";
import { listedDay } from "../stack/catalog";
import { describeStack } from "../stack/lock";
import { fileName } from "../thread/useThread";
import { MoneyRow } from "./MoneyRow";
import type { Prefs } from "./prefs";

interface SettingsViewProps {
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  stack: Stack;
  onOpenStack: () => void;
  keyStatus: KeyStatus | null;
  onSaveKey: (key: string) => Promise<void>;
  onForgetKey: () => Promise<void>;
  onRunSetup: () => void;
}

export function SettingsView({
  prefs,
  onChange,
  stack,
  onOpenStack,
  keyStatus,
  onSaveKey,
  onForgetKey,
  onRunSetup,
}: SettingsViewProps) {
  return (
    <div className="settings">
      <div className="swrap">
        <section className="sg" aria-labelledby="s-models">
          <h2 id="s-models" className="k">
            Models
          </h2>
          <div className="card">
            <KeyRow status={keyStatus} onSave={onSaveKey} onForget={onForgetKey} />
            <div className="srow">
              <div>
                <b>Stack</b>
                <span className="d">{describeStack(stack)}</span>
              </div>
              <button type="button" className="btn sm" onClick={onOpenStack}>
                Change in Stack
              </button>
            </div>
            <MoneyRow
              id="s-cap"
              label="Limit per thread"
              description="Shoji stops a thread before any call that could take it past this."
              value={prefs.cap}
              onChange={(cap) => onChange({ cap })}
            />
            <MoneyRow
              id="s-daily"
              label="Daily limit"
              description="Shoji asks before a thread or trial could take the day's spend past this."
              value={prefs.dailyLimit}
              onChange={(dailyLimit) => onChange({ dailyLimit })}
            />
            <SwitchRow
              label="Check the plan first"
              description="Each thread pauses once its plan is written, so you can build it or change it first."
              on={prefs.planFirst}
              onToggle={() => onChange({ planFirst: !prefs.planFirst })}
            />
            <AllowedRows prefs={prefs} onChange={onChange} />
          </div>
        </section>

        <section className="sg" aria-labelledby="s-data">
          <h2 id="s-data" className="k">
            Data
          </h2>
          <div className="card">
            <PrivateRow prefs={prefs} onChange={onChange} />
            <SwitchRow
              label="Keep models current"
              description={`Once a day Shoji downloads the list of models and their prices from its GitHub repository, so a new model or price needs no update. It sends nothing about you or your work. Prices as listed on ${listedDay()}.`}
              on={prefs.updateModels}
              onToggle={() => onChange({ updateModels: !prefs.updateModels })}
            />
          </div>
        </section>

        <section className="sg" aria-labelledby="s-look">
          <h2 id="s-look" className="k">
            Look
          </h2>
          <div className="card">
            <BackgroundRow prefs={prefs} onChange={onChange} />
            <FrostRow prefs={prefs} onChange={onChange} />
            <OpaqueRow prefs={prefs} onChange={onChange} />
            <MotionRow prefs={prefs} onChange={onChange} />
            <AccentRow prefs={prefs} onChange={onChange} />
            <DensityRow prefs={prefs} onChange={onChange} />
          </div>
        </section>

        <section className="sg" aria-labelledby="s-show">
          <h2 id="s-show" className="k">
            Show
          </h2>
          <div className="card">
            <SwitchRow
              label="Costs"
              description="What a thread or trial has spent, while it runs and on the review bar. Receipts always shows them."
              on={prefs.showCosts}
              onToggle={() => onChange({ showCosts: !prefs.showCosts })}
            />
            <SwitchRow
              label="Model names"
              description="Which model takes each step of a thread, beside the step."
              on={prefs.showModels}
              onToggle={() => onChange({ showModels: !prefs.showModels })}
            />
            <SwitchRow
              label="Status bar"
              description="The project, branch and running cost along the bottom of the window."
              on={prefs.statusBar}
              onToggle={() => onChange({ statusBar: !prefs.statusBar })}
            />
          </div>
        </section>

        <section className="sg" aria-labelledby="s-setup">
          <h2 id="s-setup" className="k">
            Setup
          </h2>
          <div className="card">
            <div className="srow">
              <div>
                <b>First-run setup</b>
                <span className="d">Walk through models, stack, project and look again.</span>
              </div>
              <button type="button" className="btn sm" onClick={onRunSetup}>
                Run setup again
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function KeyRow({
  status,
  onSave,
  onForget,
}: {
  status: KeyStatus | null;
  onSave: (key: string) => Promise<void>;
  onForget: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const attempt = (work: Promise<void>) =>
    work.then(
      () => setError(null),
      (e) => setError(String(e)),
    );

  return (
    <div className="srow">
      <label htmlFor="s-key">
        <b>Anthropic API key</b>
        <span className="d">
          {error ??
            (status?.saved
              ? "Saved in your system keychain. Shoji sends it only to Anthropic."
              : status?.fromEnv
                ? "Using the key from your shell. Save one here so Shoji has it however it opens."
                : "Kept in your system keychain. Shoji sends it only to Anthropic.")}
        </span>
      </label>
      {status?.saved ? (
        <span className="acts">
          {confirming ? (
            <>
              <span className="ask">Forget the saved key?</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setConfirming(false);
                  attempt(onForget());
                }}
              >
                Forget
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn sm" onClick={() => setConfirming(true)}>
              Forget
            </button>
          )}
        </span>
      ) : (
        <form
          className="keyform"
          onSubmit={(e) => {
            e.preventDefault();
            attempt(onSave(key).then(() => setKey("")));
          }}
        >
          <input
            id="s-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="btn sm" disabled={!key.trim()}>
            Save
          </button>
        </form>
      )}
    </div>
  );
}

/** Commands the person chose to always allow, beyond the checks, for each project. Ask again
 *  takes one off, so Shoji asks about it next time. */
function AllowedRows({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  const forget = (repo: string, command: string) => {
    const left = (prefs.allowedCommands[repo] ?? []).filter((c) => c !== command);
    const { [repo]: _, ...others } = prefs.allowedCommands;
    onChange({ allowedCommands: left.length ? { ...others, [repo]: left } : others });
  };
  return Object.entries(prefs.allowedCommands).flatMap(([repo, commands]) =>
    commands.map((command) => (
      <div className="srow" key={`${repo}\n${command}`}>
        <div>
          <b>
            Always allowed in {fileName(repo)}: <code>{command}</code>
          </b>
          <span className="d">Shoji runs it without asking. Your checks always run.</span>
        </div>
        <button type="button" className="btn sm" onClick={() => forget(repo, command)}>
          Ask again
        </button>
      </div>
    )),
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Files no role may read, change or list, as .gitignore patterns. */
function PrivateRow({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  const [typed, setTyped] = useState(prefs.privateFiles.join("\n"));
  const defaults = prefs.privateFiles.join("\n") === DEFAULT_PRIVATE.join("\n");
  const use = (patterns: string[]) => {
    setTyped(patterns.join("\n"));
    onChange({ privateFiles: patterns });
  };
  return (
    <div className="srow private">
      <label htmlFor="s-private">
        <b>Private files</b>
        <span className="d">
          No role can read, change, list or search these, so they never reach a model, and the review's diff leaves them
          out. One pattern a line, as in .gitignore. A line starting with ! keeps a file shared.
        </span>
        {!defaults && (
          <button type="button" className="btn sm ghost" onClick={() => use(DEFAULT_PRIVATE)}>
            Use the defaults
          </button>
        )}
      </label>
      <textarea
        id="s-private"
        rows={Math.max(4, typed.split("\n").length)}
        spellCheck={false}
        autoComplete="off"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange({ privateFiles: lines(e.target.value) });
        }}
        onBlur={() => setTyped(prefs.privateFiles.join("\n"))}
      />
    </div>
  );
}
