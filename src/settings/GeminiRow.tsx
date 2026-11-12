import { useState } from "react";
import type { Gemini, GeminiTier } from "../stack/gemini";

/** What Gemini gives Shoji on this tier, in a sentence. On the free tier it says first what Google does with it. */
export function geminiNote(gemini: Gemini, tier: GeminiTier): string {
  if (gemini.error) return gemini.error;
  const terms =
    tier === "free"
      ? "On the free tier, steps cost nothing, Google limits how many run a day, and Google may use what Shoji sends to improve its models."
      : "Billed by Google at its API prices. Google doesn't use what's sent on a paid key to improve its models.";
  if (gemini.status !== "connected") return `A key from Google AI Studio. ${terms}`;
  const how = gemini.fromShell ? "Using the key from your shell." : "Saved in your system keychain.";
  const count = gemini.models.length;
  return count ? `${how} ${count} model${count === 1 ? "" : "s"}. ${terms}` : `${how} ${terms}`;
}

/** Gemini's row: a key from Google AI Studio, and whether it's on the free tier, which says what that means before
 *  anything is sent. */
export function GeminiRow({
  gemini,
  tier,
  onTier,
}: {
  gemini: Gemini;
  tier: GeminiTier;
  onTier: (tier: GeminiTier) => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const attempt = (work: Promise<void>) =>
    work.then(
      () => setError(null),
      (e) => setError(String(e).replace(/^Error: /, "")),
    );

  return (
    <div className="srow">
      {/* The tier sits under the words it changes, so the key field keeps the row's right side as on the others. */}
      <div>
        <label htmlFor="s-key-gemini">
          <b>Gemini API key</b>
          <span className="d" role="status">
            {error ?? geminiNote(gemini, tier)}
          </span>
        </label>
        <div className="seg tier" role="radiogroup" aria-label="Gemini tier">
          {(["free", "paid"] as GeminiTier[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tier === t} onClick={() => onTier(t)}>
              {t === "free" ? "Free tier" : "Paid"}
            </button>
          ))}
        </div>
      </div>
      <span className="acts">
        {gemini.saved ? (
          confirming ? (
            <>
              <span className="ask">Forget the saved key?</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setConfirming(false);
                  attempt(gemini.forget());
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
          )
        ) : (
          <form
            className="keyform"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(gemini.save(key).then(() => setKey("")));
            }}
          >
            <input
              id="s-key-gemini"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button type="submit" className="btn sm" disabled={!key.trim()}>
              Save
            </button>
          </form>
        )}
      </span>
    </div>
  );
}
