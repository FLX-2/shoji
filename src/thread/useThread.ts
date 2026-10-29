import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeEvent } from "../../runtime/src/events";
import { MODELS } from "../../runtime/src/models";
import type { StackName } from "../../runtime/src/stack";
import type { Bridge, ChangesRequest, RunExit } from "../bridge";
import { foldRun } from "./fold";

/** One ask and the run that answered it: the task itself, or a request for changes. */
export interface Turn {
  ask: string;
  kind: "task" | "changes";
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
  stack: StackName;
  /** Most the whole thread may spend, in dollars. */
  cap: number;
  /** The branch the thread works on, once its first run has started. */
  branch?: string;
  /** The short hash of the commit that accepted the thread's work. */
  committed?: string;
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

/** Runs one thread through the runtime: the task, then any changes the person asks for. */
export function useThread(bridge: Bridge) {
  const [thread, setThread] = useState<Thread | null>(null);
  // The run the last turn is waiting on. "starting" until the runtime gives its number.
  const current = useRef<number | "starting" | null>(null);
  // Events or an exit that arrived before the start call returned the run's number.
  const early = useRef(new Map<number, { events: RuntimeEvent[]; exit?: RunExit }>());

  const updateLast = useCallback((change: (turn: Turn) => Turn) => {
    setThread((t) => (t ? { ...t, turns: [...t.turns.slice(0, -1), change(t.turns[t.turns.length - 1])] } : t));
  }, []);

  useEffect(() => {
    const waitingOn = (run: number) => {
      if (current.current === run) return true;
      if (current.current === "starting" && !early.current.has(run)) early.current.set(run, { events: [] });
      return false;
    };
    const subscriptions = [
      bridge.onEvent((run, event) => {
        if (waitingOn(run)) updateLast((turn) => ({ ...turn, events: [...turn.events, event] }));
        else early.current.get(run)?.events.push(event);
      }),
      bridge.onExit((exit) => {
        if (waitingOn(exit.run)) {
          current.current = null;
          updateLast((turn) => ({ ...turn, exit }));
        } else {
          const held = early.current.get(exit.run);
          if (held) held.exit = exit;
        }
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge, updateLast]);

  const run = useCallback(
    async (next: Thread, turn: Turn, changes?: ChangesRequest) => {
      const spent = threadCost(next);
      setThread({ ...next, turns: [...next.turns, turn] });
      current.current = "starting";
      early.current.clear();
      try {
        const { run: id, thread: threadId, branch } = await bridge.startRun({
          repo: next.repo,
          task: next.task,
          stack: next.stack,
          cap: next.cap - spent,
          changes,
        });
        const held = early.current.get(id);
        early.current.clear();
        current.current = held?.exit ? null : id;
        setThread((t) => (t ? { ...t, id: threadId, branch } : t));
        if (held) updateLast((t) => ({ ...t, events: [...t.events, ...held.events], exit: held.exit }));
      } catch (error) {
        current.current = null;
        updateLast((t) => ({ ...t, error: String(error) }));
      }
    },
    [bridge, updateLast],
  );

  const start = useCallback(
    (task: string, repo: string, stack: StackName, cap: number) =>
      run({ task, repo, stack, cap, turns: [] }, { ask: task, kind: "task", events: [] }),
    [run],
  );

  const requestChanges = useCallback(
    (notes: string) => {
      if (thread?.id === undefined) return;
      const plan = thread.turns.map((t) => foldRun(t.events).result?.plan).findLast(Boolean) ?? "";
      run(
        thread,
        { ask: notes, kind: "changes", events: [] },
        { thread: thread.id, notes, plan, branch: thread.branch ?? "" },
      );
    },
    [thread, run],
  );

  const stop = useCallback(async () => {
    updateLast((turn) => ({ ...turn, stoppedByYou: true }));
    await bridge.stopRun();
  }, [bridge, updateLast]);

  /** Accepts all of the thread's work as one commit on its branch. */
  const commit = useCallback(async () => {
    if (!thread?.branch || thread.id === undefined) return;
    const sha = await bridge.commitThread(thread.repo, thread.branch, commitMessage(thread), thread.id);
    setThread((t) => (t ? { ...t, committed: sha } : t));
  }, [bridge, thread]);

  return { thread, start, requestChanges, stop, commit };
}
