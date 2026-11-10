import { useCallback, useEffect, useState } from "react";
import { applyFound, type ModelId } from "../../runtime/src/models";
import { ollamaModel } from "../../runtime/src/ollama";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge } from "../bridge";

/** Every Ollama model this Shoji has found, kept so a stack or thread that names one still knows it while
 *  Ollama is closed. */
const STORE = "shoji.ollama";

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
    // Unsaved, they're found again when Ollama next answers.
  }
}

const known = (names: string[]) => applyFound("ollama", Object.fromEntries(names.map(ollamaModel)));

export interface Ollama {
  /** "looking" until Ollama answers or doesn't; "ready" when it has a model that can use tools. */
  status: "looking" | "ready" | "none" | "off";
  /** The models on this computer now that can use tools, largest first. */
  models: ModelId[];
  /** Asks Ollama again, as after the person pulls a model. */
  look: () => void;
}

/** Ollama on this computer: asked once at launch and again on request. Models found once stay known. */
export function useOllama(bridge: Bridge): Ollama {
  const [state, setState] = useState<Omit<Ollama, "look">>(() => {
    known(seenNames());
    return { status: "looking", models: [] };
  });

  const look = useCallback(() => {
    setState((now) => ({ ...now, status: "looking" }));
    bridge.ollamaModels().then(
      (pulled) => {
        const names = pulled.map((m) => m.name);
        const all = [...new Set([...names, ...seenNames()])];
        remember(all);
        known(all);
        setState({ status: names.length ? "ready" : "none", models: names.map((name) => ollamaModel(name)[0]) });
      },
      () => setState({ status: "off", models: [] }),
    );
  }, [bridge]);

  useEffect(look, [look]);
  return { ...state, look };
}

/** A stack on this computer alone: the largest model plans and builds, the smallest scouts and reviews. */
export function localStack(models: ModelId[]): Stack {
  const large = models[0];
  const small = models[models.length - 1];
  return {
    scout: { model: small, effort: "low" },
    plan: { model: large, effort: "medium" },
    build: { model: large, effort: "medium" },
    review: { model: small, effort: "low" },
  };
}
