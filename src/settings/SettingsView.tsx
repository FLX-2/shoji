import { useState } from "react";
import { STACKS, type StackName } from "../../runtime/src/stack";
import type { KeyStatus } from "../bridge";
import type { Prefs } from "./prefs";

interface SettingsViewProps {
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  keyStatus: KeyStatus | null;
  onSaveKey: (key: string) => Promise<void>;
  onForgetKey: () => Promise<void>;
}

const STACK_NAMES: Record<StackName, { label: string; detail: string }> = {
  balanced: { label: "Balanced", detail: "Opus 5.5 plans, Sonnet 5.5 builds, and Haiku 5.5 scouts and reviews." },
  opus: { label: "Opus", detail: "Opus 5.5 takes every step. It costs about twice as much as Balanced." },
  haiku: { label: "Haiku", detail: "Haiku 5.5 takes every step, for a fraction of a cent. Good for trying Shoji out." },
};

export function SettingsView({ prefs, onChange, keyStatus, onSaveKey, onForgetKey }: SettingsViewProps) {
  // The field keeps what's typed, so "0.0" can become "0.05"; only a positive amount is saved.
  const [cap, setCap] = useState(String(prefs.cap));
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
                <span className="d">{STACK_NAMES[prefs.stack].detail}</span>
              </div>
              <div className="seg" role="radiogroup" aria-label="Stack">
                {(Object.keys(STACKS) as StackName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={prefs.stack === name}
                    onClick={() => onChange({ stack: name })}
                  >
                    {STACK_NAMES[name].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="srow">
              <label htmlFor="s-cap">
                <b>Limit per thread</b>
                <span className="d">Shoji stops a thread before any call that could take it past this.</span>
              </label>
              <div className="money">
                <span aria-hidden="true">$</span>
                <input
                  id="s-cap"
                  type="number"
                  min={0.01}
                  step={0.05}
                  value={cap}
                  onChange={(e) => {
                    setCap(e.target.value);
                    if (Number(e.target.value) > 0) onChange({ cap: Number(e.target.value) });
                  }}
                  onBlur={() => setCap(String(prefs.cap))}
                />
              </div>
            </div>
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
        <button type="button" className="btn sm" onClick={() => attempt(onForget())}>
          Remove
        </button>
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
