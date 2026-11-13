import { useCallback, useEffect, useState } from "react";
import { routedModel } from "../../runtime/src/found";
import { applyFound, type ModelId, MODELS } from "../../runtime/src/models";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge, KeyStatus, RoutedModel } from "../bridge";

/** Every model OpenRouter has listed for this Shoji, with its prices, kept so a stack or thread that names one still
 *  knows it before OpenRouter answers. */
const STORE = "shoji.openrouter";

function seenModels(): RoutedModel[] {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    if (!Array.isArray(seen)) return [];
    return seen.filter(
      (m): m is RoutedModel =>
        typeof m?.id === "string" &&
        typeof m?.name === "string" &&
        [m.input, m.output, m.cacheRead].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0),
    );
  } catch {
    return [];
  }
}

function remember(models: RoutedModel[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(models));
  } catch {
    // Unsaved, they're listed again when OpenRouter next answers.
  }
}

const known = (models: RoutedModel[]) =>
  applyFound(
    "openrouter",
    Object.fromEntries(models.map((m) => routedModel(m.id, m.name, m.input, m.output, m.cacheRead))),
  );

/**
 * Whether a run can take an OpenRouter model. The spending limits rest on prices, so the runtime turns down a
 * model listed at no charge unless its id says it's free, with :free. A stack that named any other one failed
 * every run as it started, so such a model keeps its name for older threads but isn't offered.
 */
export const runnable = (id: ModelId): boolean =>
  id.endsWith(":free") || ((MODELS[id]?.input ?? 0) > 0 && (MODELS[id]?.output ?? 0) > 0);

export interface OpenRouter {
  /** "looking" until Shoji has read its key; "connecting" while the browser is open. */
  status: "looking" | "connected" | "disconnected" | "connecting";
  /** The key came from the shell, not from connecting here. */
  fromShell: boolean;
  /** How many of OpenRouter's models can use tools, once it has answered. */
  count: number | null;
  /** Its free models that can use tools, largest first, once it has answered. */
  free: ModelId[];
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const plain = (e: unknown) => String(e).replace(/^Error: /, "");

/** OpenRouter: connected once in the browser, after which its models join Stack's lists at its prices. */
export function useOpenRouter(bridge: Bridge): OpenRouter {
  const [key, setKey] = useState<KeyStatus | null>(() => {
    known(seenModels());
    return null;
  });
  const [connecting, setConnecting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [free, setFree] = useState<ModelId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connected = !!key && (key.saved || key.fromEnv);

  const read = useCallback(
    () => bridge.keyStatus("openrouter").then(setKey, () => setKey({ saved: false, fromEnv: false })),
    [bridge],
  );
  useEffect(() => {
    read();
  }, [read]);

  // Lists the models once connected. Ones listed before stay known, so older threads keep their names.
  useEffect(() => {
    if (!connected) return;
    let current = true;
    bridge.openrouterModels().then(
      (listed) => {
        if (!current) return;
        const all = [...listed, ...seenModels().filter((m) => !listed.some((l) => l.id === m.id))];
        remember(all);
        known(all);
        setCount(listed.length);
        setFree(freeModels(listed.map((m) => m.id)));
      },
      (e) => current && setError(`Shoji couldn't read OpenRouter's models: ${plain(e)}`),
    );
    return () => {
      current = false;
    };
  }, [bridge, connected]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await bridge.openrouterConnect();
    } catch (e) {
      setError(plain(e));
    }
    setConnecting(false);
    await read();
  }, [bridge, read]);

  const disconnect = useCallback(async () => {
    try {
      await bridge.forgetKey("openrouter");
      setError(null);
    } catch (e) {
      setError(plain(e));
    }
    setCount(null);
    setFree([]);
    await read();
  }, [bridge, read]);

  const status = key === null ? "looking" : connecting ? "connecting" : connected ? "connected" : "disconnected";
  return {
    status,
    fromShell: !!key && !key.saved && key.fromEnv,
    count,
    free: connected ? free : [],
    error,
    connect,
    disconnect,
  };
}

/** A model's size in billions of parameters, as its id names it ("550b-a55b" is 550), or 0 when it doesn't. */
function size(id: string): number {
  const named = [...id.matchAll(/(\d+(?:\.\d+)?)b(?![a-z])/g)].map((m) => Number(m[1]));
  return named.length ? Math.max(...named) : 0;
}

/** OpenRouter's free models among those it listed, largest first, since a larger model plans and builds better.
 *  Free models churn, so they're picked from what OpenRouter lists now rather than from a list Shoji keeps. */
export function freeModels(ids: string[]): ModelId[] {
  return ids
    .filter((id) => id.endsWith(":free"))
    .map((id, order) => ({ id, order, size: size(id) }))
    .sort((a, b) => b.size - a.size || a.order - b.order)
    .map(({ id }) => `openrouter/${id}`);
}

/** A stack on OpenRouter's free models: the largest takes every step. It costs nothing, so there's no saving in a
 *  smaller model, and free models count requests, not tokens. */
export function freeStack(models: ModelId[]): Stack {
  const largest = models[0];
  return {
    scout: { model: largest, effort: "low" },
    plan: { model: largest, effort: "medium" },
    build: { model: largest, effort: "medium" },
    review: { model: largest, effort: "low" },
  };
}
