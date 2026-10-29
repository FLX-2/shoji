import { MODELS } from "../../runtime/src/models";
import { parseStack, ROLES, STACKS, type Role, type Seat, type Stack, type StackName } from "../../runtime/src/stack";

/** One saved choice of models. */
export interface LockVersion {
  /** When it was saved, in milliseconds since 1970. */
  at: number;
  stack: Stack;
}

/** stack.lock: every stack the person has saved, oldest first. The last one is in use. */
export interface StackLock {
  versions: LockVersion[];
}

export const ROLE_NAMES: Record<Role, { label: string; does: string }> = {
  scout: { label: "Scout", does: "Finds the files that matter and sums them up." },
  plan: { label: "Plan", does: "Writes the steps the build follows." },
  build: { label: "Build", does: "Edits the code and fixes what the checks catch." },
  review: { label: "Review", does: "Reads the diff and says if it's ready." },
};

export const PRESETS: Record<StackName, string> = {
  balanced: "Balanced",
  opus: "Opus",
  haiku: "Haiku",
};

/** Reads stack.lock. Throws if it isn't one, so a bad file is never taken as an empty history. */
export function parseLock(text: string): StackLock {
  const value: unknown = JSON.parse(text);
  const versions = (value as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(versions)) throw new Error("stack.lock has no list of versions.");
  return {
    versions: versions.map((v: { at?: unknown; stack?: unknown }) => {
      if (typeof v?.at !== "number") throw new Error("A version in stack.lock has no time.");
      return { at: v.at, stack: parseStack(JSON.stringify(v.stack)) };
    }),
  };
}

export function serializeLock(lock: StackLock): string {
  return JSON.stringify(lock, null, 2) + "\n";
}

export const sameSeat = (a: Seat, b: Seat) => a.model === b.model && a.effort === b.effort;

export const sameStack = (a: Stack, b: Stack) => ROLES.every((role) => sameSeat(a[role], b[role]));

export function presetOf(stack: Stack): StackName | null {
  return (Object.keys(STACKS) as StackName[]).find((name) => sameStack(STACKS[name], stack)) ?? null;
}

/** The roles whose seat differs from one stack to the next. */
export const changedRoles = (from: Stack, to: Stack) => ROLES.filter((role) => !sameSeat(from[role], to[role]));

export const seatLabel = (seat: Seat) => `${MODELS[seat.model].label}, ${EFFORT_NAMES[seat.effort].toLowerCase()}`;

export const EFFORT_NAMES = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" } as const;

const VERBS: Record<Role, string> = { plan: "plans", build: "builds", scout: "scouts", review: "reviews" };

/** "Opus 5.5 plans, Sonnet 5.5 builds, and Haiku 5.5 scouts and reviews." */
export function describeStack(stack: Stack): string {
  const byModel = new Map<string, Role[]>();
  for (const role of ["plan", "build", "scout", "review"] as Role[]) {
    const label = MODELS[stack[role].model].label;
    byModel.set(label, [...(byModel.get(label) ?? []), role]);
  }
  if (byModel.size === 1) return `${[...byModel.keys()][0]} takes every step.`;
  const parts = [...byModel].map(([label, roles]) => `${label} ${and(roles.map((r) => VERBS[r]))}`);
  return `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}.`;
}

function and(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** A ledger thread's stack: the JSON the app has recorded since stack.lock, or an earlier preset name. */
export function stackOf(recorded: string): Stack | null {
  if (recorded in STACKS) return STACKS[recorded as StackName];
  try {
    return parseStack(recorded);
  } catch {
    return null;
  }
}

/** A stack in a few words: its preset's name, or each role's model and effort. */
export function stackSummary(recorded: string): string {
  const stack = stackOf(recorded);
  if (!stack) return recorded;
  const preset = presetOf(stack);
  if (preset) return PRESETS[preset];
  return ROLES.map((role) => `${ROLE_NAMES[role].label} ${seatLabel(stack[role])}`).join("; ");
}
