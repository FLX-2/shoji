import { labelOf, MODELS, type ModelId } from "../../runtime/src/models";
import type { Role, Stack } from "../../runtime/src/stack";
import { modelGroups } from "../stack/ModelPick";
import { readsAsQuestion } from "./asks";

/**
 * Where a message goes. Shoji routes each message to the seats that fit it, the way the Stack routes each step to
 * a model, so the person never picks a stage before they write.
 *
 * - task: Scout, Plan, Build, checks, Review. A new thread's full route.
 * - quick: Build, checks, Review, skipping Scout and Plan. A small change in a new thread.
 * - answer: Scout reads and replies. Nothing changes.
 * - change: Build, checks, Review, on top of the thread's work and plan.
 * - replan: Scout and Plan write the plan again from the message, and pause.
 * - review: the checks and Review look at the work again.
 */
export type RouteKind = "task" | "quick" | "answer" | "change" | "replan" | "review";

/** A next step said in words, which does what its chip does and calls no model by itself. */
export type Move = "commit" | "push" | "build" | "retry" | "resume" | "keep-going" | "fix";

/** Where a thread stands, which decides the routes it offers. */
export type Place = "home" | "planned" | "work" | "fresh";

export interface Route {
  kind: RouteKind;
  /** A model the person named for this message, on the seat the route leads with. */
  model?: ModelId;
}

/** What one message does: a route with the text to send, or a move. */
export type Said = { route: Route; text: string } | { move: Move };

/** The routes each place offers, in the order the menu lists them. */
export const ROUTES: Record<Place, RouteKind[]> = {
  home: ["task", "quick", "answer"],
  // A thread whose first run stopped before it had a plan: it can take changes, built without one.
  fresh: ["change", "answer"],
  planned: ["replan", "answer"],
  work: ["change", "answer", "replan", "review"],
};

/** The seat each route leads with: the one a named model goes to, and the one its mark names. */
export const LEADS: Record<RouteKind, Role> = {
  task: "plan",
  quick: "build",
  answer: "scout",
  change: "build",
  replan: "plan",
  review: "review",
};

export const ROUTE_NAMES: Record<RouteKind, { label: string; does: string }> = {
  task: { label: "Full task", does: "Scout, Plan, Build, checks, Review" },
  quick: { label: "Quick change", does: "Build, checks, Review. Skips the plan" },
  answer: { label: "Answer", does: "Scout reads and replies. Nothing changes" },
  change: { label: "Change", does: "Build, checks, Review, on top of the work" },
  replan: { label: "Rethink the plan", does: "Plan again from what you write" },
  review: { label: "Review again", does: "The checks and Review look at the work again" },
};

/** The seats a person can hand a message to by name, and the route each one takes from a place. */
const SEATS: Record<string, Record<Place, RouteKind>> = {
  scout: { home: "answer", fresh: "answer", planned: "answer", work: "answer" },
  plan: { home: "task", fresh: "change", planned: "replan", work: "replan" },
  build: { home: "quick", fresh: "change", planned: "replan", work: "change" },
  review: { home: "answer", fresh: "answer", planned: "answer", work: "review" },
};

/** "@review on opus: is it right?" — a seat, an optional model, and the message. */
const SEAT_MENTION = /^@(scout|plan|build|review)\b(?:\s+(?:on|with|using)\s+([\w.\- ]+?))?\s*[:,]?(?:\s+|$)/i;

/** The seats as the composer's @ list offers them, after the files. */
export const SEAT_NAMES = ["scout", "plan", "build", "review"] as const;

/** Short replies that move the work on, as their chips do. Only a short message is read as one. */
const MOVES: [Move, RegExp][] = [
  ["commit", /^(commit|accept)( it| this| the work| that)?( please)?$|^(looks good|lgtm|ship it)(,? commit( it)?)?$/i],
  ["push", /^(push( it)?|open (a |the )?(pr|pull request)|push and open (a |the )?(pr|pull request))( please)?$/i],
  ["build", /^(build( it| the plan)?|go( ahead)?|looks good,? build( it)?)( please)?$/i],
  ["retry", /^(try( it)? again|retry|run it again)( please)?$/i],
  ["resume", /^(pick (it )?up( where it stopped)?|resume)( please)?$/i],
  ["keep-going", /^(keep going|continue|carry on|go on)( please)?$/i],
  ["fix", /^(fix (it|that|this|what the review (found|said))|fix the review notes)( please)?$/i],
];

/** Words that ask for the plan to be written again. */
const RETHINK = /\b(rethink|re-?plan|plan (it |this )?again|(a )?different approach|another approach|new plan|start the plan over)\b/i;

/** Words that ask for the work to be judged again. */
const LOOK_AGAIN = /^(please )?(review|check|look at)( it| this| the work)? again\b|\b(review it again|look again|double-check (it|the work))\b/i;

/** A small edit, said plainly: on Home it can skip the plan. */
const SMALL = /^(rename|bump|fix (a |the )?typo|typo|change the (text|label|copy|colou?r|title|wording|name)|update the (text|label|copy|version|readme|title)|remove (the|a|an|unused)|delete (the|a|an|unused))\b/i;

/** The move a short message asks for, if it's one this place can do. */
function moveIn(text: string, can: (move: Move) => boolean): Move | null {
  const said = text.trim().replace(/[.!]+$/, "");
  if (said.length > 60 || said.includes("\n")) return null;
  return MOVES.find(([move, words]) => words.test(said) && can(move))?.[0] ?? null;
}

/** The route a message would take on its own words, with no seat named. */
export function guessRoute(text: string, place: Place): RouteKind {
  const said = text.trim();
  const offered = ROUTES[place];
  if (readsAsQuestion(said) && offered.includes("answer")) return "answer";
  if (place === "home") return SMALL.test(said) && said.length < 140 && !said.includes("\n") ? "quick" : "task";
  if (place === "work" && LOOK_AGAIN.test(said)) return "review";
  if (place === "work" && RETHINK.test(said)) return "replan";
  return offered[0];
}

/** The newest model the person can reach whose name has these words, such as "opus" or "gpt 5.5". */
export function modelNamed(words: string, reaches: (model: ModelId) => boolean): ModelId | undefined {
  const wanted = words.toLowerCase().replace(/[-_]/g, " ").split(/\s+/).filter(Boolean);
  if (!wanted.length) return undefined;
  const fits = (id: ModelId) => {
    const name = `${labelOf(id)} ${id}`.toLowerCase().replace(/[-_]/g, " ");
    return wanted.every((w) => name.includes(w));
  };
  return modelGroups(Object.keys(MODELS).filter(reaches).filter(fits))[0]?.ids[0];
}

export interface Reading {
  place: Place;
  /** Moves the place can do now. */
  can: (move: Move) => boolean;
  reaches: (model: ModelId) => boolean;
  /** Read only the person's own picks: no guessing from the words. */
  noGuess?: boolean;
}

/**
 * What a message does. A seat named first decides the route; a short next step said in words is that move; any
 * other message takes the route its words suggest. `picked` is a route the person chose in the menu, which wins
 * over the guess but not over a seat they named.
 */
export function readMessage(text: string, reading: Reading, picked?: RouteKind): Said {
  const { place, can, reaches, noGuess } = reading;
  const seat = text.match(SEAT_MENTION);
  if (seat) {
    const kind = SEATS[seat[1].toLowerCase()][place];
    const model = seat[2] ? modelNamed(seat[2], reaches) : undefined;
    const rest = text.slice(seat[0].length).trim();
    return { route: { kind, ...(model && { model }) }, text: rest || text.trim() };
  }
  if (!picked) {
    const move = moveIn(text, can);
    if (move) return { move };
  }
  const kind = picked ?? (noGuess ? ROUTES[place][0] : guessRoute(text, place));
  return { route: { kind }, text: text.trim() };
}

/** The route's mark in the composer: its name and the model its lead seat runs on. */
export function routeMark(route: Route, stack: Stack): string {
  const lead = LEADS[route.kind];
  const model = route.model ?? stack[lead].model;
  const seat = lead[0].toUpperCase() + lead.slice(1);
  return `${ROUTE_NAMES[route.kind].label} · ${seat} on ${labelOf(model)}`;
}

/** The stack one message runs on: the thread's, with a named model on the route's lead seat. */
export function stackFor(route: Route, stack: Stack): Stack {
  if (!route.model) return stack;
  const lead = LEADS[route.kind];
  return { ...stack, [lead]: { ...stack[lead], model: route.model } };
}
