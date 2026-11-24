import { useCallback, useEffect, useState } from "react";
import { applyFound, type ModelId } from "../../runtime/src/models";
import { localModel } from "../../runtime/src/found";
import type { Bridge } from "../bridge";

/** Every local-server model this Shoji has found, kept so a stack or thread that names one still knows it while
 *  the server is closed. */
const STORE = "shoji.local";

function seenNames(): string[] {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(seen) ? seen.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
}

function remember(names: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(names));
  } catch {
    // Unsaved, they're found again when the server next answers.
  }
}

const known = (names: string[]) => applyFound("local", Object.fromEntries(names.map(localModel)));

export interface LocalServer {
  /** "looking" until a server answers or none does; "ready" when one has a model loaded. */
  status: "looking" | "ready" | "off";
  /** Which server answered: LM Studio, llama.cpp, or the one SHOJI_LOCAL_URL names. */
  name: string | null;
  /** The models it has loaded, as it lists them. */
  models: ModelId[];
  /** Asks again, as after the person starts the server or loads a model. */
  look: () => void;
}

/** LM Studio or llama.cpp's server on this computer: asked once at launch and again on request. */
export function useLocalServer(bridge: Bridge): LocalServer {
  const [state, setState] = useState<Omit<LocalServer, "look">>(() => {
    known(seenNames());
    return { status: "looking", name: null, models: [] };
  });

  const look = useCallback(() => {
    setState((now) => ({ ...now, status: "looking" }));
    bridge.localModels().then(
      (found) => {
        const all = [...new Set([...found.models, ...seenNames()])];
        remember(all);
        known(all);
        setState({ status: "ready", name: found.name, models: found.models.map((name) => localModel(name)[0]) });
      },
      () => setState({ status: "off", name: null, models: [] }),
    );
  }, [bridge]);

  useEffect(look, [look]);
  return { ...state, look };
}
