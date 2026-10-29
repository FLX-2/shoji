import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OUT_OF_TURNS, runAgent } from "./agent";
import type { RuntimeEvent } from "./events";
import { BudgetExceeded, Meter } from "./meter";
import * as prompts from "./prompts";
import type { ModelProvider } from "./provider";
import type { Seat } from "./stack";
import { READ_TOOLS } from "./tools";
import { Workspace } from "./workspace";

export const NOTES_FILE = "SHOJI.md";

const HEADER = `<!-- Shoji's scout wrote these notes. Edit them freely: Plan reads them before every task. -->\n\n`;

export interface NotesResult {
  /** ready: the notes were written. kept: the project already had them, so nothing ran. */
  status: "ready" | "kept" | "stopped" | "failed";
  reason?: string;
  notes: string;
  cost: number;
}

export type NotesEvent = RuntimeEvent | { type: "notes"; result: NotesResult };

export interface NotesInput {
  root: string;
  /** The stack's scout seat, which reads the project. */
  seat: Seat;
  provider: ModelProvider;
  /** Hard spending cap, in dollars. */
  cap: number;
  emit: (event: NotesEvent) => void;
}

/**
 * Has the scout read the project and write SHOJI.md, the notes Plan reads before every task. The
 * file stays out of git through the project's own exclude list, so it never makes the project
 * look changed or lands in a commit. A project that already has notes keeps them.
 */
export async function writeNotes(input: NotesInput): Promise<NotesResult> {
  const { root, seat, emit } = input;
  const file = path.join(root, NOTES_FILE);
  const finish = (result: NotesResult) => {
    emit({ type: "notes", result });
    return result;
  };
  if (fs.existsSync(file)) return finish({ status: "kept", notes: fs.readFileSync(file, "utf8"), cost: 0 });

  const meter = new Meter(input.provider, emit, input.cap);
  const step = "notes";
  try {
    emit({ type: "step", step, role: "scout", model: seat.model, status: "running" });
    const notes = await runAgent({
      meter,
      workspace: new Workspace(root),
      allowedCommands: [],
      role: "scout",
      step,
      seat,
      system: prompts.NOTES,
      prompt: "Write the notes for this project.",
      tools: READ_TOOLS,
      maxTurns: 8,
      onTool: (tool, input) => emit({ type: "tool", step, tool, target: input.path ?? input.pattern ?? "" }),
    });
    emit({ type: "step", step, role: "scout", model: seat.model, status: "done", output: notes });
    if (!notes || notes === OUT_OF_TURNS) {
      return finish({
        status: "failed",
        reason: "The scout didn't finish reading the project.",
        notes: "",
        cost: meter.spent,
      });
    }
    fs.writeFileSync(file, `${HEADER}${notes}\n`);
    excludeFromGit(root);
    return finish({ status: "ready", notes, cost: meter.spent });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return finish({
      status: error instanceof BudgetExceeded ? "stopped" : "failed",
      reason,
      notes: "",
      cost: meter.spent,
    });
  }
}

/** Lists SHOJI.md in the project's own .git/info/exclude, which is never committed or shared. */
export function excludeFromGit(root: string) {
  const found = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).stdout.trim();
  if (!found) return;
  const exclude = path.resolve(root, found);
  const line = `/${NOTES_FILE}`;
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (current.split(/\r?\n/).includes(line)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`);
}
