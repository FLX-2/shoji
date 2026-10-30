import { useCallback, useEffect, useRef, useState } from "react";
import type { Briefing, TrialEvent } from "../../runtime/src/trial";
import type { Bridge, RunExit, TrialRequest } from "../bridge";

export interface Trial {
  request: TrialRequest;
  events: TrialEvent[];
  /** Set once the runtime has exited. */
  exit?: RunExit;
  /** Set when the trial couldn't start. */
  error?: string;
  stoppedByYou?: boolean;
}

/** The task a trial is on, how much it has spent, and its briefing once it has one. */
export function trialProgress(trial: Trial) {
  let task: { index: number; total: number; task: string } | null = null;
  let spent = 0;
  let briefing: Briefing | null = null;
  for (const event of trial.events) {
    if (event.type === "task") task = event;
    else if (event.type === "runtime" && event.event.type === "call") spent += event.event.call.cost;
    else if (event.type === "briefing") briefing = event.briefing;
  }
  return { task, spent, briefing, running: !trial.exit && !trial.error };
}

/** Runs one trial at a time and keeps the last one, wherever the person goes in the app. */
export function useTrial(bridge: Bridge) {
  const [trial, setTrial] = useState<Trial | null>(null);
  const current = useRef<number | "starting" | null>(null);
  // Events that arrived before the start call returned the trial's run number.
  const early = useRef(new Map<number, { events: TrialEvent[]; exit?: RunExit }>());

  useEffect(() => {
    const waitingOn = (run: number) => {
      if (current.current === run) return true;
      if (current.current === "starting" && !early.current.has(run)) early.current.set(run, { events: [] });
      return false;
    };
    const subscriptions = [
      bridge.onTrialEvent((run, event) => {
        if (waitingOn(run)) setTrial((t) => t && { ...t, events: [...t.events, event] });
        else early.current.get(run)?.events.push(event);
      }),
      bridge.onExit((exit) => {
        if (waitingOn(exit.run)) {
          current.current = null;
          setTrial((t) => t && { ...t, exit });
        } else {
          const held = early.current.get(exit.run);
          if (held) held.exit = exit;
        }
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge]);

  const start = useCallback(
    async (request: TrialRequest) => {
      setTrial({ request, events: [] });
      current.current = "starting";
      early.current.clear();
      try {
        const run = await bridge.startTrial(request);
        const held = early.current.get(run);
        early.current.clear();
        current.current = held?.exit ? null : run;
        if (held) setTrial((t) => t && { ...t, events: [...t.events, ...held.events], exit: held.exit });
      } catch (error) {
        current.current = null;
        setTrial((t) => t && { ...t, error: String(error) });
      }
    },
    [bridge],
  );

  const stop = useCallback(async () => {
    const run = current.current;
    if (typeof run !== "number") return;
    setTrial((t) => t && { ...t, stoppedByYou: true });
    await bridge.stopRun(run);
  }, [bridge]);

  return { trial, start, stop };
}
