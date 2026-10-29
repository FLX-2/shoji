import { useState } from "react";
import { EFFORTS, MODELS, type ModelId } from "../../runtime/src/models";
import { ROLES, STACKS, type Role, type Seat, type Stack, type StackName } from "../../runtime/src/stack";
import type { Bridge, TrialRequest } from "../bridge";
import {
  changedRoles,
  describeStack,
  EFFORT_NAMES,
  presetOf,
  PRESETS,
  ROLE_NAMES,
  sameStack,
  seatLabel,
  type StackLock,
} from "./lock";
import { TrialSection } from "./TrialSection";
import type { Trial } from "./useTrial";

interface StackViewProps {
  bridge: Bridge;
  /** The open project, whose accepted work a trial replays. */
  repo: string | null;
  trial: Trial | null;
  onStartTrial: (request: TrialRequest) => void;
  onStopTrial: () => void;
  stack: Stack;
  lock: StackLock;
  /** Why stack.lock couldn't be read, if it couldn't. */
  error: string | null;
  onSave: (stack: Stack) => Promise<void>;
}

const MODEL_IDS = Object.keys(MODELS) as ModelId[];

function when(at: number): string {
  return new Date(at).toLocaleString("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Which model and effort takes each step, saved to stack.lock with its history. */
export function StackView({
  bridge,
  repo,
  trial,
  onStartTrial,
  onStopTrial,
  stack,
  lock,
  error,
  onSave,
}: StackViewProps) {
  const [draft, setDraft] = useState<Stack | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const shown = draft ?? stack;
  const changed = changedRoles(stack, shown);
  const preset = presetOf(shown);
  const version = lock.versions.length + 1;

  const edit = (next: Stack) => setDraft(sameStack(next, stack) ? null : next);
  const seat = (role: Role, change: Partial<Seat>) => edit({ ...shown, [role]: { ...shown[role], ...change } });
  const save = () =>
    onSave(shown).then(
      () => {
        setDraft(null);
        setSaveError(null);
      },
      (e) => setSaveError(String(e)),
    );

  return (
    <>
      <div className="mh">
        <h1>Stack</h1>
        <span className="r">
          <span className="note">Changes apply to the next thread</span>
        </span>
      </div>

      <div className="stack">
        <div className="smain">
          <section className="crew" aria-labelledby="crew-h">
            <div className="crewh">
              <div>
                <h2 id="crew-h">Which model takes each step</h2>
                <p>{describeStack(shown)}</p>
              </div>
              <div className="seg" role="radiogroup" aria-label="Preset">
                {(Object.keys(STACKS) as StackName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={preset === name}
                    onClick={() => edit(STACKS[name])}
                  >
                    {PRESETS[name]}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              {ROLES.map((role) => (
                <div key={role} className="srow role" data-changed={changed.includes(role) || undefined}>
                  <div>
                    <b>{ROLE_NAMES[role].label}</b>
                    <span className="d">{ROLE_NAMES[role].does}</span>
                  </div>
                  <div className="seg" role="radiogroup" aria-label={`${ROLE_NAMES[role].label} model`}>
                    {MODEL_IDS.map((model) => (
                      <button
                        key={model}
                        type="button"
                        role="radio"
                        aria-checked={shown[role].model === model}
                        onClick={() => seat(role, { model })}
                      >
                        {MODELS[model].label.split(" ")[0]}
                      </button>
                    ))}
                  </div>
                  <div className="seg" role="radiogroup" aria-label={`${ROLE_NAMES[role].label} effort`}>
                    {EFFORTS.map((effort) => (
                      <button
                        key={effort}
                        type="button"
                        role="radio"
                        aria-checked={shown[role].effort === effort}
                        onClick={() => seat(role, { effort })}
                      >
                        {EFFORT_NAMES[effort]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {(draft || saveError || error) && (
              <div className="savebar" role="status">
                <p>
                  {saveError
                    ? `Couldn't save stack.lock: ${saveError}`
                    : draft
                      ? changed
                          .map((role) => `${ROLE_NAMES[role].label} becomes ${seatLabel(shown[role])}`)
                          .join(". ") + "."
                      : `stack.lock couldn't be read: ${error} Saving starts a new one.`}
                </p>
                {draft && (
                  <span className="acts">
                    <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>
                      Discard
                    </button>
                    <button type="button" className="btn sm solid" onClick={save}>
                      Save as version {version}
                    </button>
                  </span>
                )}
              </div>
            )}
          </section>

          <TrialSection
            bridge={bridge}
            repo={repo}
            saved={stack}
            candidate={shown}
            trial={trial}
            onStart={onStartTrial}
            onStop={onStopTrial}
          />

          <section className="prices" aria-labelledby="prices-h">
            <h2 id="prices-h">Prices</h2>
            <div className="ptable" role="table" aria-label="Prices per million tokens">
              <div className="prow head" role="row">
                <span role="columnheader">Model</span>
                <span role="columnheader" className="n">
                  Input
                </span>
                <span role="columnheader" className="n">
                  Output
                </span>
                <span role="columnheader" className="n">
                  Read from cache
                </span>
              </div>
              {MODEL_IDS.map((model) => (
                <div key={model} className="prow" role="row">
                  <span role="cell">{MODELS[model].label}</span>
                  <span role="cell" className="n">
                    ${MODELS[model].input.toFixed(2)}
                  </span>
                  <span role="cell" className="n">
                    ${MODELS[model].output.toFixed(2)}
                  </span>
                  <span role="cell" className="n">
                    ${MODELS[model].cacheRead.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <p className="d">Dollars per million tokens, as Anthropic listed them on 28 Oct 2026.</p>
          </section>
        </div>

        <History lock={lock} current={stack} onUse={(s) => edit(s)} />
      </div>
    </>
  );
}

function History({ lock, current, onUse }: { lock: StackLock; current: Stack; onUse: (stack: Stack) => void }) {
  const versions = lock.versions.map((v, i) => ({ ...v, n: i + 1, before: lock.versions[i - 1]?.stack }));
  return (
    <aside className="rpane spane" aria-label="History">
      <h2>stack.lock</h2>
      {versions.length === 0 ? (
        <p className="meta">Nothing saved yet. Saving writes your choice here, and keeps every earlier one.</p>
      ) : (
        <>
          <pre className="lockfile">
            {ROLES.map((role) => `${role.padEnd(8)}${current[role].model.padEnd(19)}${current[role].effort}`).join(
              "\n",
            )}
          </pre>
          <ol className="versions" reversed>
            {versions.reverse().map((v) => {
              const preset = presetOf(v.stack);
              const roles = v.before ? changedRoles(v.before, v.stack) : [];
              return (
                <li key={v.n} aria-current={v.n === lock.versions.length ? "true" : undefined}>
                  <span className="vh">
                    <b>Version {v.n}</b>
                    <span className="meta">{when(v.at)}</span>
                  </span>
                  <span className="meta">
                    {roles.length
                      ? roles.map((role) => `${ROLE_NAMES[role].label} on ${seatLabel(v.stack[role])}`).join(". ")
                      : preset
                        ? `The ${PRESETS[preset]} stack`
                        : describeStack(v.stack)}
                  </span>
                  {v.n !== lock.versions.length && !sameStack(v.stack, current) && (
                    <button type="button" className="btn sm ghost" onClick={() => onUse(v.stack)}>
                      Use again
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </aside>
  );
}
