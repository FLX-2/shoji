import { useCallback, useState } from "react";
import type { StackName } from "../../runtime/src/stack";

export interface Prefs {
  /** The open project's folder. */
  repo: string | null;
  stack: StackName;
  /** Most a thread may spend, in dollars, across its runs. */
  cap: number;
  /** Interface motion. Off removes every transition. */
  motion: boolean;
}

export const DEFAULT_PREFS: Prefs = { repo: null, stack: "balanced", cap: 0.5, motion: true };

const STORE = "shoji.prefs";

function load(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(load);
  const update = useCallback((change: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the choice still holds until the app closes.
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
