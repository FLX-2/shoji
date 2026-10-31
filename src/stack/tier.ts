import { MODELS, type ModelId } from "../../runtime/src/models";
import type { Stack } from "../../runtime/src/stack";
import type { LedgerThread } from "../bridge";
import { callsOf, isNotes, isTrial, priceAs } from "../receipts/receipts";

/** How much a task is worth: the stack moves down for a draft and up for the best result. */
export type Tier = "draft" | "balanced" | "max";

export const TIERS: Record<Tier, { label: string; does: string }> = {
  draft: { label: "Draft", does: "Build and Review each move down one model" },
  balanced: { label: "Balanced", does: "Every role runs on your stack" },
  max: { label: "Max", does: "Build runs on the Plan model" },
};

/** The next model down by output price, or the same one when it's the cheapest. */
function cheaper(model: ModelId): ModelId {
  const ladder = Object.keys(MODELS).sort((a, b) => MODELS[a].output - MODELS[b].output);
  return ladder[Math.max(0, ladder.indexOf(model) - 1)];
}

/** The stack a task runs on at this tier. Plan and Scout never move, so the receipt's baseline stays put. */
export function tierStack(stack: Stack, tier: Tier): Stack {
  if (tier === "draft")
    return {
      ...stack,
      build: { ...stack.build, model: cheaper(stack.build.model) },
      review: { ...stack.review, model: cheaper(stack.review.model) },
    };
  if (tier === "max") return { ...stack, build: { ...stack.plan } };
  return stack;
}

/** Which tier of `base` a thread's stack is, or null when it's none of them, as after the stack changed. */
export function tierOf(stack: Stack, base: Stack): Tier | null {
  const same = (a: Stack, b: Stack) => JSON.stringify(a) === JSON.stringify(b);
  return (["balanced", "draft", "max"] as Tier[]).find((t) => same(stack, tierStack(base, t))) ?? null;
}

/** Fewer finished tasks than this, and there's nothing honest to estimate from. */
const LEAST_HISTORY = 3;
const RECENT = 20;

/**
 * What a task usually costs on this stack: the median of the person's recent tasks, with every
 * call's tokens priced on the model the stack gives its role. An estimate, since other models
 * would have taken their own paths. Null until there's enough history.
 */
export function estimateCost(threads: LedgerThread[], stack: Stack): number | null {
  const recent = threads
    .filter((t) => !isTrial(t) && !isNotes(t) && t.runs.some((run) => run.status && run.status !== "planned"))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, RECENT);
  if (recent.length < LEAST_HISTORY) return null;
  const costs = recent
    .map((t) =>
      callsOf(t).reduce(
        (sum, call) => sum + (call.model in MODELS ? priceAs(stack[call.role].model, call) : call.cost),
        0,
      ),
    )
    .sort((a, b) => a - b);
  const mid = costs.length >> 1;
  return costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2;
}
