import type { DiffLine } from "./diff";

/** What the person wrote about one line of the thread's diff, for Build to act on. */
export interface LineComment {
  path: string;
  /** The line's number in the file as it is now, or as it was for a removed line. */
  line: number;
  /** A removed line no longer exists, so Build is told so. */
  removed: boolean;
  /** The line itself, so Build knows which one even if numbers move. */
  code: string;
  text: string;
}

export function commentOn(path: string, line: DiffLine, text: string): LineComment {
  const removed = line.kind === "del";
  return { path, line: (removed ? line.old : line.new) ?? 0, removed, code: line.text.trim(), text: text.trim() };
}

/** Whether a comment belongs to this line of this file. */
export const isOn = (c: LineComment, path: string, line: DiffLine) =>
  c.path === path && c.removed === (line.kind === "del") && c.line === (c.removed ? line.old : line.new);

/** The comments as one request for changes, in file and line order. */
export function commentsNote(comments: LineComment[]): string {
  const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const lines = sorted.map((c) => {
    const where = `${c.path}, ${c.removed ? "removed " : ""}line ${c.line}`;
    const code = c.code ? ` (\`${c.code.length > 80 ? `${c.code.slice(0, 80)}…` : c.code}\`)` : "";
    return `- ${where}${code}: ${c.text}`;
  });
  return `Comments on the code:\n${lines.join("\n")}`;
}
