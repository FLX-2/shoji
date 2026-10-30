import type Anthropic from "@anthropic-ai/sdk";
import { runCommand } from "./commands";
import type { Workspace } from "./workspace";

const MAX_LISTED = 400;
const MAX_MATCHES = 200;

function tool(name: string, description: string, properties: Record<string, string>): Anthropic.Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([k, d]) => [k, { type: "string", description: d }])),
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export const READ_TOOLS: Anthropic.Tool[] = [
  tool("list_files", "List the files under a folder of the project, skipping dependencies and build output.", {
    path: "Folder relative to the project root, or . for the root",
  }),
  tool("read_file", "Read a file from the project, with line numbers.", {
    path: "File path relative to the project root",
  }),
  tool("search", "Search the project's files for a regular expression. Returns path:line: text.", {
    pattern: "A JavaScript regular expression",
  }),
];

export const WRITE_TOOLS: Anthropic.Tool[] = [
  tool("write_file", "Create a file, or replace a file's whole content.", {
    path: "File path relative to the project root",
    content: "The complete new content of the file",
  }),
  tool("replace_in_file", "Replace one exact, unique piece of text in a file.", {
    path: "File path relative to the project root",
    old_text: "Text that appears exactly once in the file",
    new_text: "What to put in its place",
  }),
];

export const COMMAND_TOOLS: Anthropic.Tool[] = [
  tool(
    "run_command",
    "Run a command in the project. Its check commands run at once. Any other command, such as installing a package, waits for the person to allow it, so run one only when the task needs it.",
    { command: "The command to run" },
  ),
];

/** Runs one tool call. Failures come back as text for the model to read, never as exceptions. */
export function runTool(
  workspace: Workspace,
  allowedCommands: string[],
  name: string,
  input: Record<string, string>,
): string {
  try {
    switch (name) {
      case "list_files": {
        const files = workspace.files(input.path);
        const more = files.length > MAX_LISTED ? `\n…and ${files.length - MAX_LISTED} more` : "";
        return files.slice(0, MAX_LISTED).join("\n") + more || "(no files)";
      }
      case "read_file":
        return workspace
          .read(input.path)
          .split("\n")
          .map((line, i) => `${String(i + 1).padStart(4)} ${line}`)
          .join("\n");
      case "search":
        return search(workspace, input.pattern);
      case "write_file":
        workspace.write(input.path, input.content);
        return "Written.";
      case "replace_in_file": {
        const text = workspace.read(input.path);
        const count = text.split(input.old_text).length - 1;
        if (count !== 1) return `Error: old_text appears ${count} times; it must appear exactly once.`;
        workspace.write(input.path, text.replace(input.old_text, () => input.new_text));
        return "Replaced.";
      }
      case "run_command": {
        if (!allowedCommands.includes(input.command)) {
          return `Error: only these commands can run: ${allowedCommands.join(", ") || "none"}.`;
        }
        const result = runCommand(workspace.root, input.command);
        return `${result.ok ? "Passed" : "Failed"}.\n${result.output}`;
      }
      default:
        return `Error: there is no tool called ${name}.`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function search(workspace: Workspace, pattern: string): string {
  const regex = new RegExp(pattern);
  const matches: string[] = [];
  for (const file of workspace.files()) {
    let text: string;
    try {
      text = workspace.read(file);
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    text.split("\n").forEach((line, i) => {
      if (matches.length < MAX_MATCHES && regex.test(line)) matches.push(`${file}:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches.join("\n") || "(no matches)";
}
