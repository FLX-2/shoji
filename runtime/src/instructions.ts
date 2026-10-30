import { NOTES_FILE } from "./notes";
import type { Workspace } from "./workspace";

/** The files where projects keep instructions for coding agents, read from the project's root. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/** Instructions longer than this are cut, so one huge file can't crowd out the task. */
const MOST_CHARS = 20_000;

/** A file at the project's root, unless it's missing, private, unreadable or empty. */
function readRoot(workspace: Workspace, file: string): string | null {
  try {
    const text = workspace.read(file).trim();
    if (!text) return null;
    return text.length > MOST_CHARS
      ? `${text.slice(0, MOST_CHARS)}\n\n(The rest of ${file} was cut for length.)`
      : text;
  } catch {
    return null;
  }
}

/**
 * The project's own instructions for coding agents, from AGENTS.md and CLAUDE.md, as Plan, Build and
 * Review read them. A file the person keeps private isn't read.
 */
export function projectInstructions(workspace: Workspace): string {
  return INSTRUCTION_FILES.map((file) => {
    const text = readRoot(workspace, file);
    return text ? `\n\nThe project's instructions (${file}):\n${text}` : "";
  }).join("");
}

/** SHOJI.md holds the project's own notes for the team, written during setup. Plan reads them. */
export function projectNotes(workspace: Workspace): string {
  const text = readRoot(workspace, NOTES_FILE);
  return text ? `\n\nProject notes (${NOTES_FILE}):\n${text}` : "";
}
