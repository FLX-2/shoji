import { useCallback } from "react";
import { applyFound, type ModelId } from "../../runtime/src/models";
import { localModel } from "../../runtime/src/found";
import type { Bridge } from "../bridge";
import { useLooking } from "./looking";

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
  /** Set when the person asked to look again and still no server answered. */
  missed?: boolean;
  /** Asks again, as after the person starts the server or loads a model. */
  look: () => void;
}

type Found = Omit<LocalServer, "look" | "missed">;

/** LM Studio or llama.cpp's server on this computer: asked at launch, whenever Shoji comes back into focus, and
 *  on request. */
export function useLocalServer(bridge: Bridge): LocalServer {
  const ask = useCallback(
    (): Promise<Found> =>
      bridge.localModels().then(
        (found) => {
          const all = [...new Set([...found.models, ...seenNames()])];
          remember(all);
          known(all);
          return { status: "ready", name: found.name, models: found.models.map((name) => localModel(name)[0]) };
        },
        () => ({ status: "off", name: null, models: [] }),
      ),
    [bridge],
  );
  return useLooking<Found>(ask, firstLook);
}

function firstLook(): Found {
  known(seenNames());
  return { status: "looking", name: null, models: [] };
}
