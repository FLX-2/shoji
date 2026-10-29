import type { Effort, ModelId } from "./models";

export type Role = "scout" | "plan" | "build" | "review";

export interface Seat {
  model: ModelId;
  effort: Effort;
}

export type Stack = Record<Role, Seat>;

export const STACKS = {
  /** The routing spike's winner: 55% cheaper per accepted task than Opus alone. */
  balanced: {
    scout: { model: "claude-haiku-5-5", effort: "low" },
    plan: { model: "claude-opus-5-5", effort: "medium" },
    build: { model: "claude-sonnet-5-5", effort: "medium" },
    review: { model: "claude-haiku-5-5", effort: "low" },
  },
  /** One strong model everywhere, the baseline that receipts compare against. */
  opus: {
    scout: { model: "claude-opus-5-5", effort: "medium" },
    plan: { model: "claude-opus-5-5", effort: "medium" },
    build: { model: "claude-opus-5-5", effort: "medium" },
    review: { model: "claude-opus-5-5", effort: "medium" },
  },
  /** For development: every role on Haiku, at fractions of a cent per task. */
  haiku: {
    scout: { model: "claude-haiku-5-5", effort: "low" },
    plan: { model: "claude-haiku-5-5", effort: "low" },
    build: { model: "claude-haiku-5-5", effort: "low" },
    review: { model: "claude-haiku-5-5", effort: "low" },
  },
} satisfies Record<string, Stack>;

export type StackName = keyof typeof STACKS;
