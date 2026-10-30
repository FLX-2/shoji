import { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge } from "../bridge";

/** Lines of a server's output kept for showing why it stopped or hasn't answered yet. */
const KEPT = 40;

/** A dev server Shoji started in one folder: a thread's copy of the project. */
export interface Server {
  /** Its number, once it has started. */
  id?: number;
  command: string;
  /** Its latest lines of output. */
  lines: string[];
  /** The local address it printed, once it has. */
  url?: string;
  /** Set once it has stopped, with its exit code if it had one. */
  exit?: { code: number | null };
  /** Set when it couldn't start. */
  error?: string;
}

export const serverRunning = (server: Server | undefined) => !!server && !server.exit && !server.error;

// Terminal colours, which servers such as Vite put inside the address they print.
const COLOURS = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

/** The first address on this computer in a line of a server's output, such as Vite's "Local: http://localhost:5173/". */
export function localUrl(line: string): string | undefined {
  const found = line.replace(COLOURS, "").match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'")\]]*/);
  return found?.[0].replace(/[.,;]+$/, "");
}

/** What a new project most likely starts its dev server with, from the files it has. */
export function guessCommand(files: string[]): string {
  if (!files.includes("package.json")) return "";
  if (files.includes("pnpm-lock.yaml")) return "pnpm dev";
  if (files.includes("yarn.lock")) return "yarn dev";
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun run dev";
  return "npm run dev";
}

/** A server with more lines of its output, and the address it printed once it has. */
function heard(server: Server, lines: string[]): Server {
  if (!lines.length) return server;
  const url = server.url ?? lines.map(localUrl).find(Boolean);
  return { ...server, lines: [...server.lines, ...lines].slice(-KEPT), ...(url && { url }) };
}

/** The dev servers Shoji started, one for each folder, so Preview can show each thread's own work. */
export function useServers(bridge: Bridge) {
  const [servers, setServers] = useState<Record<string, Server>>({});
  // Which folder each server serves, by its number.
  const dirs = useRef(new Map<number, string>());
  // Output or an end that arrived before the start call returned the server's number.
  const early = useRef(new Map<number, { lines: string[]; code?: number | null }>());
  const held = (id: number) => {
    if (!early.current.has(id)) early.current.set(id, { lines: [] });
    return early.current.get(id)!;
  };

  const update = useCallback((dir: string, change: (server: Server) => Server) => {
    setServers((all) => (all[dir] ? { ...all, [dir]: change(all[dir]) } : all));
  }, []);

  useEffect(() => {
    const subscriptions = [
      bridge.onServerOutput((id, line) => {
        const dir = dirs.current.get(id);
        if (dir === undefined) held(id).lines.push(line);
        else update(dir, (s) => heard(s, [line]));
      }),
      bridge.onServerExit((id, code) => {
        const dir = dirs.current.get(id);
        if (dir === undefined) held(id).code = code;
        else {
          dirs.current.delete(id);
          update(dir, (s) => ({ ...s, exit: { code } }));
        }
      }),
    ];
    return () => subscriptions.forEach((s) => s.then((unlisten) => unlisten()));
  }, [bridge, update]);

  const start = useCallback(
    async (dir: string, command: string) => {
      setServers((all) => ({ ...all, [dir]: { command, lines: [] } }));
      try {
        const id = await bridge.startServer(dir, command);
        const caught = early.current.get(id);
        early.current.delete(id);
        if (caught?.code === undefined) dirs.current.set(id, dir);
        update(dir, (s) => ({
          ...heard({ ...s, id }, caught?.lines ?? []),
          ...(caught?.code !== undefined && { exit: { code: caught.code } }),
        }));
      } catch (error) {
        update(dir, (s) => ({ ...s, error: String(error) }));
      }
    },
    [bridge, update],
  );

  const stop = useCallback(
    (dir: string) => {
      const id = servers[dir]?.id;
      if (id !== undefined && serverRunning(servers[dir])) return bridge.stopServer(id);
    },
    [bridge, servers],
  );

  return { servers, start, stop };
}
