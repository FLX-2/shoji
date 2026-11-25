import { useCallback, useEffect, useMemo, useState } from "react";
import { GEMINI_FREE, geminiClosed, geminiFreeFamily, geminiModel } from "../../runtime/src/found";
import { apiName, applyFound, MODELS, type ModelId, type ModelInfo } from "../../runtime/src/models";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge, KeyStatus } from "../bridge";

/** Every Gemini model this Shoji has found on the person's key, kept so a stack or thread that names one still
 *  knows it before Google answers. */
const STORE = "shoji.gemini";

type Listed = { id: string; name: string };

function seenModels(): Listed[] {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(seen)
      ? seen.filter((m): m is Listed => typeof m?.id === "string" && typeof m?.name === "string")
      : [];
  } catch {
    return [];
  }
}

function remember(models: Listed[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(models));
  } catch {
    // Unsaved, they're listed again when Google next answers.
  }
}

/** Puts the listed models in Shoji's lists, at no charge on the free tier, and returns the ones it offers. */
function known(models: Listed[], free: boolean): ModelId[] {
  const offered = models
    .map((m) => geminiModel(m.id, m.name, free))
    .filter((m): m is [ModelId, ModelInfo] => m !== null);
  applyFound("gemini", Object.fromEntries(offered));
  return offered.map(([id]) => id);
}

export type GeminiTier = "free" | "paid";

export interface Gemini {
  /** "looking" until Shoji has read the key's status. */
  status: "looking" | "connected" | "disconnected";
  /** The key came from the shell, not from saving it here. */
  fromShell: boolean;
  saved: boolean;
  /** The models Shoji offers on this key and tier, dearest first, once Google has answered. */
  models: ModelId[];
  error: string | null;
  save: (key: string) => Promise<void>;
  forget: () => Promise<void>;
}

const plain = (e: unknown) => String(e).replace(/^Error: /, "");

/** Gemini on the person's Google AI Studio key: on its free tier, steps cost nothing and Google may learn from
 *  them; on a paid key, they're billed at Google's prices. */
export function useGemini(bridge: Bridge, tier: GeminiTier): Gemini {
  const free = tier === "free";
  const [key, setKey] = useState<KeyStatus | null>(null);
  const [listed, setListed] = useState<Listed[]>(seenModels);
  const [error, setError] = useState<string | null>(null);
  const connected = !!key && (key.saved || key.fromEnv);

  const read = useCallback(
    () => bridge.keyStatus("gemini").then(setKey, () => setKey({ saved: false, fromEnv: false })),
    [bridge],
  );
  useEffect(() => {
    read();
  }, [read]);

  // Lists the key's models once connected, and again when the key changes.
  useEffect(() => {
    if (!connected) return;
    let current = true;
    bridge.geminiModels().then(
      (models) => {
        if (!current) return;
        remember(models);
        setListed(models);
        setError(null);
      },
      (e) => current && setError(plain(e)),
    );
    return () => {
      current = false;
    };
  }, [bridge, connected, key]);

  const offered = useMemo(() => known(listed, free), [listed, free]);
  const models = connected ? [...offered].sort((a, b) => MODELS[b].output - MODELS[a].output) : [];

  const save = useCallback(
    async (value: string) => {
      await bridge.saveKey(value, "gemini");
      await read();
    },
    [bridge, read],
  );
  const forget = useCallback(async () => {
    await bridge.forgetKey("gemini");
    setError(null);
    await read();
  }, [bridge, read]);

  const status = key === null ? "looking" : connected ? "connected" : "disconnected";
  return { status, fromShell: !!key && !key.saved && key.fromEnv, saved: !!key?.saved, models, error, save, forget };
}

/** A stack on a paid Gemini key: the dearest model plans and builds, and the cheapest scouts and reviews, leaving
 *  out models Google no longer serves to new keys. */
export function geminiStack(models: ModelId[]): Stack {
  const open = models.filter((m) => !geminiClosed(apiName(m)));
  const offered = open.length ? open : models;
  const large = offered[0];
  const small = offered[offered.length - 1];
  return {
    scout: { model: small, effort: "low" },
    plan: { model: large, effort: "medium" },
    build: { model: large, effort: "medium" },
    review: { model: small, effort: "low" },
  };
}

/**
 * A stack on Gemini's free tier. Google allows each free model only 20 requests a day, so the steps are spread over
 * models with their own allowances where the key has them: the strongest builds, the next plans, and the smaller
 * ones review and scout. With two, the stronger plans and builds. A key with none Shoji knows to be free for new
 * keys falls back to the paid stack's choice.
 */
export function geminiFreeStack(models: ModelId[]): Stack {
  // One model for each allowance, strongest first: the group's first-named model the key lists, its stable id
  // before a preview.
  const ranked = GEMINI_FREE.flatMap((group) => {
    for (const name of group) {
      const family = models.filter((m) => geminiFreeFamily(apiName(m)) === name);
      if (family.length) return [family.find((m) => apiName(m) === name) ?? family[0]];
    }
    return [];
  });
  if (!ranked.length) return geminiStack(models);
  const last = ranked.length - 1;
  return {
    scout: { model: ranked[Math.min(3, last)], effort: "low" },
    plan: { model: ranked[ranked.length > 2 ? 1 : 0], effort: "medium" },
    build: { model: ranked[0], effort: "medium" },
    review: { model: ranked[Math.min(2, last)], effort: "low" },
  };
}
