import { type Effort, MODELS, type ModelId } from "./models";

export type Role = "scout" | "plan" | "build" | "review";

export const ROLES: readonly Role[] = ["scout", "plan", "build", "review"];

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

/** A table of each stack's model and effort for every role, built from STACKS and MODELS. */
export function describeStacks(): string {
  const stacks: [string, Stack][] = Object.entries(STACKS);
  const cell = (seat: Seat) => `${MODELS[seat.model].label} (${seat.effort})`;
  const nameWidth = Math.max(...stacks.map(([name]) => name.length)) + 2;
  const widths = ROLES.map((role) => Math.max(role.length, ...stacks.map(([, s]) => cell(s[role]).length)) + 2);
  const line = (name: string, cells: string[]) =>
    `  ${name.padEnd(nameWidth)}${cells.map((c, i) => c.padEnd(widths[i])).join("")}`.trimEnd();
  return [line("", [...ROLES]), ...stacks.map(([name, s]) => line(name, ROLES.map((role) => cell(s[role]))))].join("\n");
}
