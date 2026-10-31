import { useCallback, useState } from "react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import type { StackName } from "../../runtime/src/stack";
import type { AccentId } from "../look/accent";
import type { FieldId } from "../look/fields";
import type { Queued, Schedule } from "../schedule/schedule";
import type { SectionId } from "../shell/sections";

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
  /** Models the person has had the chance to try: those Shoji knew when this was first set, and each new one
   *  once it's tried or set aside. Stack marks any other model the list brings Worth a trial. Null until then. */
  seenModels: string[] | null;
  /** The MCP servers the person added, as the JSON they pasted, so it reads back as they wrote it. */
  mcpServers: string;
  /** Let Build start the dev server in its copy and look at pages in a headless browser. */
  lookAtPages: boolean;
  /** Tasks Shoji starts by itself on a schedule. */
  schedules: Schedule[];
  /** Tasks waiting their turn, first in line first. */
  queue: Queued[];
  /** Tell the person through the system when a thread asks for them or ends, and count waiting threads on the
   *  app's icon. */
  notify: boolean;
  /** How each thread stood when the person last looked at it, by ledger id, to mark the ones with news. Unset
   *  until the ledger is first read, when every thread then counts as seen. */
  seen?: Record<number, string>;
  /** Where the person was when Shoji closed, to open there again: the section, and the thread on show. */
  place?: { section: SectionId; thread?: number };
  /** The thread list is hidden, for more room, with Ctrl+B or ⌘B. */
  listHidden: boolean;
  /** The project whose threads alone the list shows, or null for every project. */
  listProject?: string | null;
  /** The thread list's groups the person folded away. */
  foldedGroups: string[];
  /** How large the whole interface is drawn, 1 being as designed: one of TEXT_SIZES. */
  textSize: number;
  /** Projects the person removed from the list, with when, by folder. A thread started later brings one back. */
  hiddenProjects: Record<string, number>;
  /** First tasks Scout's notes suggested, by project folder. */
  starters: Record<string, string[]>;
}

/** The text sizes Look offers, and Ctrl or ⌘ with + and − steps through. */
export const TEXT_SIZES = [0.9, 1, 1.1, 1.25];

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
  seenModels: null,
  mcpServers: "",
  lookAtPages: true,
  schedules: [],
  queue: [],
  notify: true,
  listHidden: false,
  foldedGroups: [],
  textSize: 1,
  hiddenProjects: {},
  starters: {},
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
  // A change can be worked out from the prefs as they are then, for an undo that lands after other changes.
  const update = useCallback((change: Partial<Prefs> | ((current: Prefs) => Partial<Prefs>)) => {
    setPrefs((current) => {
      const next = { ...current, ...(typeof change === "function" ? change(current) : change) };
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
