import { useCallback, useEffect, useState } from "react";
import { applyFound, type ModelId } from "../../runtime/src/models";
import { planModel } from "../../runtime/src/found";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge, PlanModel } from "../bridge";

/** Every model a ChatGPT plan has offered this Shoji, kept so a stack or thread that names one still knows it
 *  while signed out. */
const STORE = "shoji.chatgpt";

function seenModels(): PlanModel[] {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    if (!Array.isArray(seen)) return [];
    return seen.filter(
      (m): m is PlanModel => typeof m?.slug === "string" && typeof m?.displayName === "string",
    );
  } catch {
    return [];
  }
}

function remember(models: PlanModel[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(models));
  } catch {
    // Unsaved, they're found again at the next sign-in.
  }
}

const known = (models: PlanModel[]) =>
  applyFound("chatgpt", Object.fromEntries(models.map((m) => planModel(m.slug, m.displayName))));

type State = Omit<ChatGPT, "signIn" | "signOut" | "gotIt">;

const OUT: State = { status: "signed-out", email: null, models: [], error: null, welcome: false };

const plain = (e: unknown) => String(e).replace(/^Error: /, "");

export interface ChatGPT {
  /** "looking" until Shoji has read its sign-in; "signing-in" while the browser is open. */
  status: "looking" | "signed-in" | "signed-out" | "signing-in";
  email: string | null;
  /** The models the plan offers now, best first as ChatGPT lists them. */
  models: ModelId[];
  /** What went wrong last, in a sentence, if anything did. */
  error: string | null;
  /** Signed in just now, so the row says once that runs use the plan. */
  welcome: boolean;
  /** Puts the welcome away. */
  gotIt: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** The person's ChatGPT plan: read at launch, and changed by signing in or out in Settings. */
export function useChatGPT(bridge: Bridge): ChatGPT {
  const [state, setState] = useState<State>(() => {
    known(seenModels());
    return { status: "looking", email: null, models: [], error: null, welcome: false };
  });

  /** Reads the plan's models once signed in. A failure leaves the plan signed in, with the models seen before. */
  const listModels = useCallback(
    async (email: string | null, welcome = false) => {
      let offered: PlanModel[] = [];
      let error: string | null = null;
      try {
        offered = await bridge.chatgptModels();
      } catch (e) {
        error = `Shoji couldn't read your plan's models: ${String(e)}`;
      }
      const all = [...offered, ...seenModels().filter((m) => !offered.some((o) => o.slug === m.slug))];
      remember(all);
      known(all);
      const shown = offered.length ? offered : seenModels();
      setState({
        status: "signed-in",
        email,
        models: shown.map((m) => planModel(m.slug, m.displayName)[0]),
        error,
        welcome,
      });
    },
    [bridge],
  );

  useEffect(() => {
    let current = true;
    bridge.chatgptStatus().then(
      (status) => {
        if (!current) return;
        if (status.signedIn) listModels(status.email);
        else setState(OUT);
      },
      () => current && setState(OUT),
    );
    return () => {
      current = false;
    };
  }, [bridge, listModels]);

  const signIn = useCallback(async () => {
    setState((now) => ({ ...now, status: "signing-in", error: null }));
    try {
      const status = await bridge.chatgptSignIn();
      if (status.signedIn) await listModels(status.email, true);
      else setState(OUT);
    } catch (e) {
      setState({ ...OUT, error: plain(e) });
    }
  }, [bridge, listModels]);

  const signOut = useCallback(async () => {
    let note: string | null = null;
    try {
      note = await bridge.chatgptSignOut();
    } catch (e) {
      note = plain(e);
    }
    setState({ ...OUT, error: note });
  }, [bridge]);

  const gotIt = useCallback(() => setState((now) => ({ ...now, welcome: false })), []);

  return { ...state, signIn, signOut, gotIt };
}

/** Small models, which suit scouting and reviewing, by the words their slugs use. */
const SMALL = /\b(mini|nano|small|lite)\b/i;

/** A stack on the person's ChatGPT plan: its first full-size model plans and builds, and its first small one
 *  scouts and reviews. A plan with one size takes every step on its first model. */
export function planStack(models: ModelId[]): Stack {
  const large = models.find((m) => !SMALL.test(m)) ?? models[0];
  const small = models.find((m) => SMALL.test(m)) ?? large;
  return {
    scout: { model: small, effort: "low" },
    plan: { model: large, effort: "high" },
    build: { model: large, effort: "medium" },
    review: { model: small, effort: "medium" },
  };
}
