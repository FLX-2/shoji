import { useCallback, useEffect, useRef, useState } from "react";
import type { NotesEvent, NotesResult } from "../../runtime/src/notes";
import type { Stack } from "../../runtime/src/stack";
import type { Bridge, RunExit } from "../bridge";

/** Scout reads a project once and writes its SHOJI.md. It stops here, whatever it costs by then. */
export const NOTES_CAP = 0.05;

export interface Notes {
  repo: string;
  events: NotesEvent[];
  /** The project had a SHOJI.md already, so nothing ran. */
  kept?: boolean;
  exit?: RunExit;
  /** Set when the notes couldn't start. */
  error?: string;
}

/** What the notes have cost so far, how they ended, and whether Scout is still reading. */
export function notesProgress(notes: Notes) {
  let spent = 0;
  let result: NotesResult | null = null;
  for (const event of notes.events) {
    if (event.type === "call") spent += event.call.cost;
    else if (event.type === "notes") result = event.result;
  }
  return { spent, result, running: !notes.kept && !notes.exit && !notes.error };
}

/** Writes one project's notes at a time, following its run until the runtime exits. */
export function useNotes(bridge: Bridge) {
  const [notes, setNotes] = useState<Notes | null>(null);
  const current = useRef<number | "starting" | null>(null);
  // Events that arrived before the start call returned the run's number.
  const early = useRef<{ run: number; event?: NotesEvent; exit?: RunExit }[]>([]);

  useEffect(() => {
    const subscriptions = [
      bridge.onNotesEvent((run, event) => {
        if (current.current === run) setNotes((n) => n && { ...n, events: [...n.events, event] });
        else if (current.current === "starting") early.current.push({ run, event });
      }),
      bridge.onExit((exit) => {
        if (current.current === exit.run) {
          current.current = null;
          setNotes((n) => n && { ...n, exit });
        } else if (current.current === "starting") early.current.push({ run: exit.run, exit });
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge]);

  const start = useCallback(
    async (repo: string, stack: Stack) => {
      setNotes({ repo, events: [] });
      current.current = "starting";
      early.current = [];
      try {
        const run = await bridge.startNotes({ repo, stack, cap: NOTES_CAP });
        const held = early.current.filter((e) => e.run === run);
        early.current = [];
        if (run === null) {
          current.current = null;
          setNotes((n) => n && { ...n, kept: true });
          return;
        }
        const exit = held.find((e) => e.exit)?.exit;
        current.current = exit ? null : run;
        const events = held.flatMap((e) => (e.event ? [e.event] : []));
        setNotes((n) => n && { ...n, events: [...n.events, ...events], exit });
      } catch (error) {
        current.current = null;
        setNotes((n) => n && { ...n, error: String(error) });
      }
    },
    [bridge],
  );

  return { notes, start };
}
