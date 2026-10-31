import { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge } from "../bridge";

/** Most of a terminal's output kept for drawing it again when the person comes back to it, in characters. */
const SCROLLBACK = 256_000;

/** A shell Shoji opened in one folder: a thread's copy of the project. */
export interface TerminalSession {
  /** Its number, once it has opened. */
  id?: number;
  /** Set once its shell has ended. */
  ended?: boolean;
  /** Set when it couldn't open. */
  error?: string;
}

export const terminalOpen = (session: TerminalSession | undefined) => !!session && !session.ended && !session.error;

/**
 * The terminals Shoji opened, one for each folder. A terminal keeps running while the person looks elsewhere, and
 * its output is kept so the view can draw it again.
 */
export function useTerminals(bridge: Bridge) {
  const [sessions, setSessions] = useState<Record<string, TerminalSession>>({});
  // Which folder each terminal is in, by its number.
  const dirs = useRef(new Map<number, string>());
  const output = useRef(new Map<string, string>());
  const listeners = useRef(new Map<string, Set<(data: string) => void>>());
  // Output that arrived before the open call returned the terminal's number.
  const early = useRef(new Map<number, { data: string; ended?: boolean }>());

  const update = useCallback((dir: string, change: (session: TerminalSession) => TerminalSession) => {
    setSessions((all) => (all[dir] ? { ...all, [dir]: change(all[dir]) } : all));
  }, []);

  const heard = useCallback((dir: string, data: string) => {
    output.current.set(dir, ((output.current.get(dir) ?? "") + data).slice(-SCROLLBACK));
    listeners.current.get(dir)?.forEach((listen) => listen(data));
  }, []);

  useEffect(() => {
    const held = (id: number) => {
      if (!early.current.has(id)) early.current.set(id, { data: "" });
      return early.current.get(id)!;
    };
    const subscriptions = [
      bridge.onTerminalOutput((id, data) => {
        const dir = dirs.current.get(id);
        if (dir === undefined) held(id).data += data;
        else heard(dir, data);
      }),
      bridge.onTerminalExit((id) => {
        const dir = dirs.current.get(id);
        if (dir === undefined) held(id).ended = true;
        else {
          dirs.current.delete(id);
          update(dir, (s) => ({ ...s, ended: true }));
        }
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge, heard, update]);

  /** Opens a shell in a folder, unless one is open there already. */
  const open = useCallback(
    async (dir: string, cols: number, rows: number) => {
      if (terminalOpen(sessions[dir])) return;
      output.current.delete(dir);
      setSessions((all) => ({ ...all, [dir]: {} }));
      try {
        const id = await bridge.openTerminal(dir, cols, rows);
        const caught = early.current.get(id);
        early.current.delete(id);
        if (!caught?.ended) dirs.current.set(id, dir);
        if (caught?.data) heard(dir, caught.data);
        update(dir, (s) => ({ ...s, id, ...(caught?.ended && { ended: true }) }));
      } catch (error) {
        update(dir, (s) => ({ ...s, error: String(error) }));
      }
    },
    [bridge, heard, sessions, update],
  );

  const live = (dir: string) => {
    const session = sessions[dir];
    return terminalOpen(session) ? session.id : undefined;
  };

  const write = (dir: string, data: string) => {
    const id = live(dir);
    if (id !== undefined) bridge.writeTerminal(id, data).catch(() => {});
  };

  const resize = (dir: string, cols: number, rows: number) => {
    const id = live(dir);
    if (id !== undefined) bridge.resizeTerminal(id, cols, rows).catch(() => {});
  };

  /** Follows a folder's terminal output from now on. Returns the way to stop. */
  const follow = useCallback((dir: string, listen: (data: string) => void) => {
    if (!listeners.current.has(dir)) listeners.current.set(dir, new Set());
    listeners.current.get(dir)!.add(listen);
    return () => listeners.current.get(dir)?.delete(listen);
  }, []);

  /** What a folder's terminal has printed so far, for drawing it again. */
  const history = useCallback((dir: string) => output.current.get(dir) ?? "", []);

  return { sessions, open, write, resize, follow, history };
}
