import { useCallback, useEffect, useState } from "react";
import { routedModel } from "../../runtime/src/found";
import { applyFound } from "../../runtime/src/models";
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

export interface OpenRouter {
  /** "looking" until Shoji has read its key; "connecting" while the browser is open. */
  status: "looking" | "connected" | "disconnected" | "connecting";
  /** The key came from the shell, not from connecting here. */
  fromShell: boolean;
  /** How many of OpenRouter's models can use tools, once it has answered. */
  count: number | null;
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
    await read();
  }, [bridge, read]);

  const status = key === null ? "looking" : connecting ? "connecting" : connected ? "connected" : "disconnected";
  return { status, fromShell: !!key && !key.saved && key.fromEnv, count, error, connect, disconnect };
}
