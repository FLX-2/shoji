import { MODELS, PROVIDER_NAMES, providerOf, type ModelId, type ProviderId } from "../../runtime/src/models";
import { ROLES, type Stack } from "../../runtime/src/stack";
import type { ProviderPreset } from "./presets";

/** Another way to carry on a thread whose free tier or plan ran out: its stack with the seats that ran on that
 *  provider moved to one the person has connected. */
export interface Route {
  /** Who takes over, as the person knows them: "Ollama", or "Ollama and Anthropic". */
  name: string;
  stack: Stack;
}

/** At most this many routes are offered, so the choice stays a glance. */
const MOST = 2;

/** A model that spends nothing: on this computer, on the person's plan, or on a free tier. Ollama's models are
 *  local even before Shoji has listed them. */
const costsNothing = (model: ModelId) => {
  const billing = MODELS[model]?.billing;
  return billing === "local" || billing === "plan" || billing === "free" || providerOf(model) === "ollama";
};

/**
 * The routes a thread can carry on with when `limited` ran out: each connected preset, and the person's own stack,
 * fill the seats that were on `limited` and leave the rest where they are. Routes that spend nothing come first,
 * since a free tier running out is no reason to start paying. `reaches` says which models the person can run now.
 */
export function carryOnRoutes(
  stack: Stack,
  limited: ProviderId,
  candidates: ProviderPreset[],
  reaches: (model: ModelId) => boolean,
): Route[] {
  const moved = ROLES.filter((role) => providerOf(stack[role].model) === limited);
  if (!moved.length) return [];
  const routes: (Route & { free: boolean })[] = [];
  for (const candidate of candidates) {
    const seats = moved.map((role) => [role, candidate.stack[role]] as const);
    if (seats.some(([, seat]) => providerOf(seat.model) === limited || !reaches(seat.model))) continue;
    const next = { ...stack, ...Object.fromEntries(seats) } as Stack;
    const name = [...new Set(seats.map(([, seat]) => PROVIDER_NAMES[providerOf(seat.model)]))].join(" and ");
    if (routes.some((r) => r.name === name)) continue;
    routes.push({ name, stack: next, free: seats.every(([, seat]) => costsNothing(seat.model)) });
  }
  return routes
    .sort((a, b) => Number(b.free) - Number(a.free))
    .slice(0, MOST)
    .map(({ name, stack }) => ({ name, stack }));
}

/** When a limit lifts, as the person reads it: "at 4:00 PM", "tomorrow at 12:00 AM", or "on Friday at 9:00 AM". */
export function opensAt(at: number, now = Date.now()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(when) - day(new Date(now))) / 86_400_000);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${when.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}
