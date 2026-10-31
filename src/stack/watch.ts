import { MODELS, type ModelId } from "../../runtime/src/models";
import { ROLES, type Role, type Stack } from "../../runtime/src/stack";
import type { LedgerThread } from "../bridge";
import { firstTry, isNotes, isTrial, reworked } from "../receipts/receipts";
import { ROLE_NAMES } from "./lock";
import { locale } from "../shell/locale";

const DAY = 24 * 60 * 60 * 1000;
/** This week is compared with the four weeks before it. */
const RECENT = 7 * DAY;
const BEFORE = 28 * DAY;
/** Fewer steps or threads than this on either side, and a change is noise. */
const LEAST = 5;
/** A step this much slower or dearer than before counts. */
const RISE = 1.25;
/** First-try acceptance this many points lower than before counts. */
const DROP = 0.2;

const DOING: Record<Role, string> = {
  scout: "reading the code",
  plan: "planning",
  build: "building",
  review: "reviewing",
};

/** A model the stack uses that got slower, dearer or worse at its role this week. */
export interface Regression {
  role: Role;
  model: ModelId;
  headline: string;
  detail: string;
}

export interface Watch {
  /** Whether any role had enough history on both sides to compare. */
  compared: boolean;
  regressions: Regression[];
}

interface Step {
  at: number;
  seconds: number;
  cost: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function day(at: number): string {
  return new Date(at).toLocaleString(locale(), {
    day: "numeric",
    month: "short",
  });
}

/** Each step a role took on a model, with the time and money its calls added up to. */
function stepsOf(threads: LedgerThread[], role: Role, model: ModelId): Step[] {
  const steps = new Map<string, Step>();
  for (const thread of threads)
    for (const run of thread.runs)
      for (const call of run.calls) {
        if (call.role !== role || call.model !== model) continue;
        const key = `${run.id}/${call.step}`;
        const step = steps.get(key) ?? { at: call.at, seconds: 0, cost: 0 };
        step.at = Math.min(step.at, call.at);
        step.seconds += call.seconds;
        step.cost += call.cost;
        steps.set(key, step);
      }
  return [...steps.values()];
}

const percent = (ratio: number) => `${Math.round((ratio - 1) * 100)}%`;

/**
 * Compares this week of the person's own work with the four weeks before, for each model the
 * stack uses in its role: how long its steps take, what they cost, and for Build, how often its
 * threads are accepted without changes. Trials and project notes aren't the person's work, so
 * they don't count.
 */
export function watch(ledger: LedgerThread[], stack: Stack, now: number): Watch {
  const work = ledger.filter((t) => !isTrial(t) && !isNotes(t) && t.startedAt >= now - RECENT - BEFORE);
  let compared = false;
  const regressions: Regression[] = [];

  for (const role of ROLES) {
    const model = stack[role].model;
    const steps = stepsOf(work, role, model);
    const recent = steps.filter((s) => s.at >= now - RECENT);
    const before = steps.filter((s) => s.at < now - RECENT);
    if (recent.length < LEAST || before.length < LEAST) continue;
    compared = true;

    const slower = median(recent.map((s) => s.seconds)) / median(before.map((s) => s.seconds));
    const dearer = median(recent.map((s) => s.cost)) / median(before.map((s) => s.cost));
    // Acceptance belongs to the whole thread. It's put down to Build, which writes the code, and
    // judged only among threads that are settled: accepted, or sent back for changes.
    const settled = work.filter((t) => t.committed !== null || t.runs.some(reworked));
    const used = (t: LedgerThread) => t.runs.some((r) => r.calls.some((c) => c.role === role && c.model === model));
    const recentThreads = settled.filter((t) => used(t) && t.startedAt >= now - RECENT);
    const beforeThreads = settled.filter((t) => used(t) && t.startedAt < now - RECENT);
    const rate = (ts: LedgerThread[]) => ts.filter(firstTry).length / ts.length;
    const judged = role === "build" && recentThreads.length >= LEAST && beforeThreads.length >= LEAST;
    const drop = judged ? rate(beforeThreads) - rate(recentThreads) : 0;

    const since = day(Math.min(...recent.map((s) => s.at)));
    const name = MODELS[model].label;
    const label = ROLE_NAMES[role].label;
    const changes: { headline: string; said: string; size: number }[] = [];
    if (slower >= RISE)
      changes.push({
        headline: `${name} got slower at ${DOING[role]}`,
        said: `${label} steps take about ${percent(slower)} longer since ${since}.`,
        size: slower - 1,
      });
    if (dearer >= RISE)
      changes.push({
        headline: `${name} costs more for ${DOING[role]}`,
        said: `${label} steps cost about ${percent(dearer)} more since ${since}.`,
        size: dearer - 1,
      });
    if (drop >= DROP) {
      const accepted = (ts: LedgerThread[]) => `${ts.filter(firstTry).length} of ${ts.length}`;
      changes.push({
        headline: `${name} got worse at ${DOING[role]}`,
        said: `${accepted(recentThreads)} threads it built were accepted first try since ${since}, against ${accepted(beforeThreads)} before.`,
        size: drop * 2,
      });
    }
    if (!changes.length) continue;

    const steady = [slower < RISE && "time", dearer < RISE && "cost", judged && drop < DROP && "quality"].filter(
      (s): s is string => !!s,
    );
    const list = steady.length > 1 ? `${steady.slice(0, -1).join(", ")} and ${steady.at(-1)}` : (steady[0] ?? "");
    const unchanged =
      list && ` ${list[0].toUpperCase()}${list.slice(1)} ${steady.length > 1 ? "are" : "is"} unchanged.`;
    changes.sort((a, b) => b.size - a.size);
    regressions.push({
      role,
      model,
      headline: changes[0].headline,
      detail: changes.map((c) => c.said).join(" ") + unchanged,
    });
  }
  return { compared, regressions };
}
