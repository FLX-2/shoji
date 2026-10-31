import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeEvent } from "../../runtime/src/events";
import { MODELS } from "../../runtime/src/models";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge, ChangesRequest, RunExit } from "../bridge";
import { foldRun, reviewNotes } from "./fold";

/** One ask and the run that answered it: the task itself, or a request for changes. */
export interface Turn {
  ask: string;
  /** The names of files attached to the ask. */
  attached?: string[];
  kind: "task" | "changes" | "build" | "replan" | "question";
  events: RuntimeEvent[];
  /** Set once the run has ended. */
  exit?: RunExit;
  /** Set when the run couldn't start. */
  error?: string;
  stoppedByYou?: boolean;
}

export interface Thread {
  /** The thread's id in the ledger, once its first run has started. */
  id?: number;
  task: string;
  repo: string;
  stack: Stack;
  /** Most the whole thread may spend, in dollars. */
  cap: number;
  /** The branch the thread works on, once its first run has started. */
  branch?: string;
  /** The thread's own copy of the project, where its work happens. Missing for a thread from before each had
   *  one, which works in the project itself. */
  workdir?: string;
  /** The short hash of the commit that accepted the thread's work. */
  committed?: string;
  /** Screenshots and files attached to the task, as paths. Every run of the thread sees them. */
  attachments?: string[];
  /** The person's name for the thread, or the title Scout gave it. */
  title?: string;
  /** The thread's work was thrown away: its copy and branch are gone, and it can only be read. */
  discarded?: boolean;
  turns: Turn[];
}

export function isRunning(turn: Turn | undefined): boolean {
  return !!turn && !turn.exit && !turn.error;
}

export function threadCost(thread: Thread): number {
  return thread.turns.reduce((sum, turn) => sum + foldRun(turn.events).cost, 0);
}

/** The commit's message: the task, then which models did the work and what it cost. */
export function commitMessage(thread: Thread): string {
  const [subject, ...body] = thread.task.trim().split("\n");
  const roles = new Map<string, Set<string>>();
  for (const turn of thread.turns) {
    for (const step of foldRun(turn.events).steps) {
      const label = MODELS[step.model].label;
      roles.set(label, (roles.get(label) ?? new Set()).add(step.role));
    }
  }
  const models = [...roles].map(([label, did]) => `${label} ${[...did].join(", ")}`).join("; ");
  const trailers = [models && `Shoji-Models: ${models}`, `Shoji-Cost: $${threadCost(thread).toFixed(4)}`];
  return [subject.trim(), body.join("\n").trim(), trailers.filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
}

// Neither asks for the checks to pass: a reviewer reading "get the checks passing" took a check that
// was failing before Shoji started as part of the task, and the next round spent its turns on it.
const KEEP_GOING =
  "The last run stopped at its spending limit before it finished. Carry on from where it stopped and finish the task.";

const FIX = "The last run ended with work left to do. Fix what the review asked for.";

/** A thread the app holds, under a key of its own, since a new thread has no ledger id until its run starts. */
export interface Held {
  key: number;
  thread: Thread;
}

/**
 * Runs threads through the runtime: each task, then any changes the person asks for. Every thread works in its
 * own copy of the project, so several run at once. One of them is on show, and the actions act on that one.
 */
export function useThreads(bridge: Bridge, allowedIn: (repo: string) => string[] = () => []) {
  const [held, setHeld] = useState<Held[]>([]);
  const [shownKey, setShownKey] = useState<number | null>(null);
  const keys = useRef(0);
  // Which thread each live run belongs to, by run number.
  const runs = useRef(new Map<number, number>());
  // Start calls that haven't returned their run's number yet.
  const starting = useRef(0);
  // Events or an exit that arrived before the start call returned the run's number.
  const early = useRef(new Map<number, { events: RuntimeEvent[]; exit?: RunExit }>());

  const update = useCallback((key: number, change: (thread: Thread) => Thread) => {
    setHeld((all) => all.map((h) => (h.key === key ? { key, thread: change(h.thread) } : h)));
  }, []);

  const updateLast = useCallback(
    (key: number, change: (turn: Turn) => Turn) =>
      update(key, (t) => ({ ...t, turns: [...t.turns.slice(0, -1), change(t.turns[t.turns.length - 1])] })),
    [update],
  );

  useEffect(() => {
    const hold = (run: number) => {
      if (!early.current.has(run)) early.current.set(run, { events: [] });
      return early.current.get(run)!;
    };
    const subscriptions = [
      bridge.onEvent((run, event) => {
        const key = runs.current.get(run);
        if (key !== undefined) updateLast(key, (turn) => ({ ...turn, events: [...turn.events, event] }));
        else if (starting.current > 0) hold(run).events.push(event);
      }),
      bridge.onExit((exit) => {
        const key = runs.current.get(exit.run);
        if (key !== undefined) {
          runs.current.delete(exit.run);
          updateLast(key, (turn) => ({ ...turn, exit }));
        } else if (starting.current > 0) hold(exit.run).exit = exit;
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge, updateLast]);

  const run = useCallback(
    async (key: number, next: Thread, turn: Turn, changes?: ChangesRequest, planOnly?: boolean) => {
      const spent = threadCost(next);
      update(key, () => ({ ...next, turns: [...next.turns, turn] }));
      starting.current++;
      try {
        const started = await bridge.startRun({
          repo: next.repo,
          task: next.task,
          stack: next.stack,
          cap: next.cap - spent,
          changes,
          ask: turn.ask,
          ...(planOnly && { planOnly }),
          ...(next.attachments?.length && { attachments: next.attachments }),
          ...(allowedIn(next.repo).length && { allowedCommands: allowedIn(next.repo) }),
        });
        const caught = early.current.get(started.run);
        early.current.delete(started.run);
        if (!caught?.exit) runs.current.set(started.run, key);
        update(key, (t) => ({
          ...t,
          id: started.thread,
          branch: started.branch,
          ...(started.workdir && { workdir: started.workdir }),
        }));
        if (caught) updateLast(key, (t) => ({ ...t, events: [...t.events, ...caught.events], exit: caught.exit }));
      } catch (error) {
        updateLast(key, (t) => ({ ...t, error: String(error) }));
      } finally {
        if (--starting.current === 0) early.current.clear();
      }
    },
    [bridge, update, updateLast, allowedIn],
  );

  /** Shows one thread, letting go of others that have finished: the ledger can read those back. */
  const show = useCallback((key: number, adding?: Thread) => {
    setHeld((all) => [
      ...all.filter((h) => h.key === key || isRunning(h.thread.turns.at(-1)) || h.thread.id === undefined),
      ...(adding ? [{ key, thread: adding }] : []),
    ]);
    setShownKey(key);
  }, []);

  /** Starts a thread and shows it. With `planFirst`, it pauses once the plan is written. In the `background`, as a
   *  scheduled task starts, it's shown only when no other thread is. */
  const start = useCallback(
    (
      task: string,
      repo: string,
      stack: Stack,
      cap: number,
      planFirst = false,
      attachments: string[] = [],
      background = false,
    ) => {
      const key = ++keys.current;
      const thread: Thread = { task, repo, stack, cap, turns: [], ...(attachments.length && { attachments }) };
      if (background) {
        setHeld((all) => [...all, { key, thread }]);
        setShownKey((shown) => shown ?? key);
      } else show(key, thread);
      return run(
        key,
        thread,
        { ask: task, kind: "task", events: [], ...(attachments.length && { attached: attachments.map(fileName) }) },
        undefined,
        planFirst,
      );
    },
    [run, show],
  );

  const shown = held.find((h) => h.key === shownKey);
  const thread = shown?.thread ?? null;

  /** The live run of the thread on show, if it has one. */
  const liveRun = useCallback(() => {
    for (const [run, key] of runs.current) if (key === shownKey) return run;
    return undefined;
  }, [shownKey]);

  /** Carries the thread on from its latest plan: changes to the work, building the plan, or a new plan. */
  const carryOn = useCallback(
    (ask: string, notes: string, kind: "changes" | "build" | "replan" | "question", extra = 0) => {
      if (!shown || shown.thread.id === undefined) return;
      const { key, thread } = shown;
      const results = thread.turns.map((t) => foldRun(t.events).result);
      const plan = results.map((r) => r?.plan).findLast(Boolean) ?? "";
      const failingBefore = [...new Set(results.flatMap((r) => r?.failingBefore ?? []))];
      const failingTestsBefore = [...new Set(results.flatMap((r) => r?.failingTestsBefore ?? []))];
      run(
        key,
        { ...thread, cap: thread.cap + extra },
        { ask, kind, events: [] },
        {
          thread: thread.id!,
          notes,
          plan,
          branch: thread.branch ?? "",
          ...(kind !== "changes" && { kind }),
          ...(failingBefore.length && { failingBefore }),
          ...(failingTestsBefore.length && { failingTestsBefore }),
        },
        kind === "replan",
      );
    },
    [shown, run],
  );

  const requestChanges = useCallback((notes: string) => carryOn(notes, notes, "changes"), [carryOn]);

  /** Raises the thread's limit by `extra` dollars and picks the work up where it stopped. */
  const keepGoing = useCallback((extra: number) => carryOn("Keep going", KEEP_GOING, "changes", extra), [carryOn]);

  /** Raises the thread's limit by `extra` dollars and works through what the last review asked for. */
  const fix = useCallback(
    (extra: number) => {
      const review = thread?.turns.map((t) => foldRun(t.events).result?.review).findLast(Boolean);
      carryOn(
        "Fix what the review found",
        review ? `${FIX}\n\nThe review said:\n${reviewNotes(review)}` : FIX,
        "changes",
        extra,
      );
    },
    [thread, carryOn],
  );

  /** Builds the plan the person read and approved. */
  const build = useCallback(() => carryOn("Build it", "", "build"), [carryOn]);

  /** Plans again from the person's notes on the plan, and pauses again. */
  const replan = useCallback((notes: string) => carryOn(notes, notes, "replan"), [carryOn]);

  /** Asks about the work. The answer changes nothing, so the thread stays where it was. */
  const question = useCallback((text: string) => carryOn(text, text, "question"), [carryOn]);

  const stop = useCallback(async () => {
    const live = liveRun();
    if (shownKey === null || live === undefined) return;
    updateLast(shownKey, (turn) => ({ ...turn, stoppedByYou: true }));
    await bridge.stopRun(live);
  }, [bridge, updateLast, liveRun, shownKey]);

  /** The person's answer to the shown thread's question about a command. */
  const answer = useCallback(
    async (allow: boolean) => {
      const live = liveRun();
      if (live !== undefined) await bridge.answerAsk(live, allow);
    },
    [bridge, liveRun],
  );

  /** Accepts all of the thread's work as one commit on its branch. */
  const commit = useCallback(async () => {
    if (!shown?.thread.branch || shown.thread.id === undefined) return;
    const { key, thread } = shown;
    const sha = await bridge.commitThread(thread.repo, thread.branch!, commitMessage(thread), thread.id!);
    update(key, (t) => ({ ...t, committed: sha }));
  }, [bridge, shown, update]);

  /** Shows a thread the app still holds, by its ledger id. False when it isn't held. */
  const showId = useCallback(
    (id: number) => {
      const found = held.find((h) => h.thread.id === id);
      if (found) show(found.key);
      return !!found;
    },
    [held, show],
  );

  /** Shows a past thread, read back from the ledger, so the person can read it or carry it on. */
  const open = useCallback(
    (past: Thread) => {
      if (past.id !== undefined && showId(past.id)) return;
      show(++keys.current, past);
    },
    [show, showId],
  );

  /** Changes a thread the app holds, by its ledger id, as when it's renamed or its work is thrown away. */
  const patch = useCallback(
    (id: number, change: Partial<Thread>) =>
      setHeld((all) => all.map((h) => (h.thread.id === id ? { ...h, thread: { ...h.thread, ...change } } : h))),
    [],
  );

  /** Shows no thread, as when the one on show is put away. */
  const close = useCallback(() => setShownKey(null), []);

  const threads = useMemo(() => held.map((h) => h.thread), [held]);

  return {
    thread,
    threads,
    start,
    requestChanges,
    keepGoing,
    fix,
    build,
    replan,
    question,
    stop,
    answer,
    commit,
    open,
    showId,
    patch,
    close,
  };
}

/** The last part of a path, on any system. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
