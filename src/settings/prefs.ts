import { useCallback, useState } from "react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import type { StackName } from "../../runtime/src/stack";
import type { AccentId } from "../look/accent";
import type { FieldId } from "../look/fields";
import type { Schedule } from "../schedule/schedule";

export interface Prefs {
  /** The open project's folder. */
  repo: string | null;
  /** The preset chosen here before stack.lock held the stack; used until a stack is saved there. */
  stack: StackName;
  /** Most a thread may spend, in dollars, across its runs. */
  cap: number;
  /** Shoji asks before a thread or trial could take a day's spend past this, in dollars. */
  dailyLimit: number;
  /** Threads pause after the plan, for the person to build it or change it. */
  planFirst: boolean;
  /** Interface motion. Off removes every transition and holds the background still. */
  motion: boolean;
  /** The background behind the main stage. */
  field: FieldId;
  /** How frosted the main stage's glass is, 0 to 100. */
  frost: number;
  /** Every surface solid, with no background and no blur. */
  opaque: boolean;
  /** The color for running and spending. */
  accent: AccentId;
  density: "comfortable" | "compact";
  /** The bar along the bottom of the window. */
  statusBar: boolean;
  /** What threads cost, shown as they run and on the review bar. */
  showCosts: boolean;
  /** Which model takes each step, shown beside it. */
  showModels: boolean;
  /** A thread's side panel opens by itself on Code when Shoji edits a file, and on Preview when it looks at a
   *  page or a preview starts. */
  autoPanel: boolean;
  /** The first-run setup was finished once, so it doesn't open on its own again. */
  setupDone: boolean;
  /** Commands beyond the checks that the person always allows, by project folder. */
  allowedCommands: Record<string, string[]>;
  /** Patterns, as in .gitignore, for files no role may read, change or list. */
  privateFiles: string[];
  /** Where each project's dev server answers, by project folder, for a thread's Preview. */
  previewUrls: Record<string, string>;
  /** The command that starts each project's dev server, by project folder, for Preview to start it. */
  devCommands: Record<string, string>;
  /** Download the current models and prices once a day. */
  updateModels: boolean;
  /** The MCP servers the person added, as the JSON they pasted, so it reads back as they wrote it. */
  mcpServers: string;
  /** Let Build start the dev server in its copy and look at pages in a headless browser. */
  lookAtPages: boolean;
  /** Tasks Shoji starts by itself on a schedule. */
  schedules: Schedule[];
}

export const DEFAULT_PREFS: Prefs = {
  repo: null,
  stack: "balanced",
  cap: 0.5,
  dailyLimit: 25,
  planFirst: true,
  motion: true,
  field: "code",
  frost: 23,
  opaque: false,
  accent: "safelight",
  density: "comfortable",
  statusBar: true,
  showCosts: true,
  showModels: true,
  autoPanel: true,
  setupDone: false,
  allowedCommands: {},
  privateFiles: DEFAULT_PRIVATE,
  previewUrls: {},
  devCommands: {},
  updateModels: true,
  mcpServers: "",
  lookAtPages: true,
  schedules: [],
};

const STORE = "shoji.prefs";

function load(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(load);
  const update = useCallback((change: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the choice still holds until the app closes.
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
