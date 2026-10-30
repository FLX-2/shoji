import os from "node:os";
import path from "node:path";

/**
 * The person's own folder of agent settings, where commands and skills they use in every project live:
 * ~/.claude, as Claude Code keeps it. SHOJI_CLAUDE_HOME points it elsewhere, as tests do.
 */
export function claudeHome(): string {
  return process.env.SHOJI_CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

/**
 * A markdown file's YAML front matter, as plain text fields, and the text after it. Only what commands and
 * skills use: one `key: value` a line, or a folded `key: >` or `key: |` block of indented lines.
 */
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if (/^[>|]-?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      value = block.filter(Boolean).join(value.startsWith(">") ? " " : "\n");
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    fields[field[1]] = value;
  }
  return { fields, body: text.slice(match[0].length) };
}

/** What a command or skill says it's for: its description, or else the first line of its text. */
export function describedAs(fields: Record<string, string>, body: string): string {
  const first = body
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return (fields.description || first || "").slice(0, 200);
}
