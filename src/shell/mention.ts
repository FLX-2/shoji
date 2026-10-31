/** Most files offered at once. */
const SHOWN = 8;

/** The @ the caret is in, if any: an @ at the start or after a space or bracket, with no space since. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && !/[\s(]/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  return /\s/.test(query) ? null : { start, query };
}

/**
 * The files that best match what was typed after the @: a file name that starts with it first,
 * then one that has it, then a folder path that has it. Shorter paths come first in each.
 */
export function matchFiles(files: string[], query: string): string[] {
  const q = query.toLowerCase();
  const scored: { file: string; score: number }[] = [];
  for (const file of files) {
    const path = file.toLowerCase();
    const name = path.slice(path.lastIndexOf("/") + 1);
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : path.includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ file, score });
  }
  scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length || a.file.localeCompare(b.file));
  return scored.slice(0, SHOWN).map((s) => s.file);
}

/** A command the task can start with, from the project's .claude/commands or the person's own. */
export interface SlashCommand {
  name: string;
  description: string;
  /** What it takes, such as "<number>". */
  hint: string;
}

/** The command being typed: a / that starts the text, with the caret still in its name. */
export function commandAt(text: string, caret: number): { query: string } | null {
  if (!text.startsWith("/") || caret < 1) return null;
  const query = text.slice(1, caret);
  return /\s/.test(query) ? null : { query };
}

/** Commands whose name starts with what was typed, then ones that have it. */
export function matchCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const rank = (c: SlashCommand) =>
    c.name.toLowerCase().startsWith(q) ? 0 : c.name.toLowerCase().includes(q) ? 1 : -1;
  return commands
    .filter((c) => rank(c) >= 0)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, SHOWN);
}
