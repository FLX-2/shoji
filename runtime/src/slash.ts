import fs from "node:fs";
import path from "node:path";
import { claudeHome, parseFrontmatter } from "./frontmatter";
import type { Workspace } from "./workspace";

/** Where a project keeps its commands, as Claude Code does. The person's own live under their home's .claude. */
export const COMMANDS_FOLDER = ".claude/commands";

const MOST_BYTES = 100_000;

/** Markdown files under a folder and its subfolders, by command name: the file's name without .md. */
function commandFiles(dir: string, skip: (file: string) => boolean): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (at: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md") && !skip(full)) {
        const name = entry.name.slice(0, -3);
        if (!found.has(name)) found.set(name, full);
      }
    }
  };
  walk(dir);
  return found;
}

/** The command file for a name: the project's first, then the person's own. */
function findCommand(name: string, workspace: Workspace, home: string): string | null {
  const project = commandFiles(path.join(workspace.root, COMMANDS_FOLDER), (full) =>
    workspace.isPrivate(workspace.relative(full)),
  );
  return project.get(name) ?? commandFiles(path.join(home, "commands"), () => false).get(name) ?? null;
}

/**
 * Text that starts with a command, such as "/fix-issue 12", becomes the command's own text with the arguments
 * put in: $ARGUMENTS takes them all, and $1, $2 and on take them one by one. A command that names no place for
 * them gets them at the end. Any other text, including a / that names no command, stays as it is.
 */
export function expandCommand(text: string, workspace: Workspace, home = claudeHome()): string {
  const match = text.match(/^\/([\w.:-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return text;
  const file = findCommand(match[1], workspace, home);
  if (!file) return text;
  let source: string;
  try {
    if (fs.statSync(file).size > MOST_BYTES) return text;
    source = fs.readFileSync(file, "utf8");
  } catch {
    return text;
  }
  const args = (match[2] ?? "").trim();
  const words = args.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  const { body } = parseFrontmatter(source);
  const named = /\$ARGUMENTS|\$\d/.test(body);
  const filled = body.replace(/\$ARGUMENTS/g, () => args).replace(/\$(\d)/g, (_, n) => words[Number(n) - 1] ?? "");
  return (named || !args ? filled : `${filled.trimEnd()}\n\nARGUMENTS: ${args}`).trim();
}
