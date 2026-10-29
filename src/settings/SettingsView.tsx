import { useState } from "react";
import type { Stack } from "../../runtime/src/stack";
import type { KeyStatus } from "../bridge";
import { describeStack } from "../stack/lock";
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
          </div>
        </section>

        <section className="sg" aria-labelledby="s-look">
          <h2 id="s-look" className="k">
            Look
          </h2>
          <div className="card">
            <div className="srow">
              <div>
                <b>Interface motion</b>
                <span className="d">Transitions when things open, close or change.</span>
              </div>
              <button
                type="button"
                className="sw"
                role="switch"
                aria-checked={prefs.motion}
                aria-label="Interface motion"
                onClick={() => onChange({ motion: !prefs.motion })}
              />
            </div>
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
  const attempt = (work: Promise<void>) => work.then(() => setError(null), (e) => setError(String(e)));

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
