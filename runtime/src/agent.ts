import type Anthropic from "@anthropic-ai/sdk";
import type { Mcp } from "./mcp";
import type { Meter } from "./meter";
import type { Preview } from "./preview";
import type { Skills } from "./skills";
import type { Role, Seat } from "./stack";
import { runTool } from "./tools";
import type { Workspace } from "./workspace";

export const MAX_TOKENS = 16000;

/** How many times a step may go to its model unless it says otherwise: enough to read around and answer. */
export const TURNS = 12;

/** Build's turns. Each file it reads or edits and each check it runs takes one, so a task across several files
 *  needs more than reading does. The thread's spending limit is the guard on how far it goes. */
export const BUILD_TURNS = 30;

/** What a step answers when it used every turn without finishing. */
export const OUT_OF_TURNS = "(The step ran out of turns before it finished.)";

/** A step's answer ran past the length one answer can be, so what came back is only its start. */
export class CutOffError extends Error {}

/** What a step is told, once, when its answer was cut off. The cut-off answer isn't kept: a tool call in it
 *  may be half written, and half a file is worse than none. */
export const CARRY_ON =
  "Your last answer ran past the length one answer can be and was cut off, so none of it was kept. Carry on from where the work stands, and keep each answer short: make one tool call at a time, and build a long file up over several edits.";

/** A plan or a review, which is one answer. Cut off part way it reads as finished and isn't, so it's refused. */
export function whole(message: Anthropic.Message, what: "plan" | "review"): string {
  if (message.stop_reason === "max_tokens")
    throw new CutOffError(
      what === "plan"
        ? "The plan ran past the length one answer can be and was cut off, so Shoji didn't build from half a plan. Try again, or split the task into smaller ones."
        : "The review ran past the length one answer can be and was cut off before its verdict. The work so far is kept.",
    );
  return textOf(message);
}

export interface AgentRun {
  meter: Meter;
  workspace: Workspace;
  allowedCommands: string[];
  role: Role;
  step: string;
  seat: Seat;
  system: string;
  prompt: string | Anthropic.ContentBlockParam[];
  tools?: Anthropic.Tool[];
  maxTurns?: number;
  /** Called before each tool runs, so the app can show the work as it happens. */
  onTool?: (name: string, input: Record<string, string>) => void;
  /** Asks the person about a command, or an MCP tool that changes things, that isn't allowed yet. Without it,
   *  such a command or tool is refused. */
  ask?: (command: string, tool?: boolean) => Promise<boolean>;
  /** The MCP servers' tools, called here when a role uses one. */
  mcp?: Mcp;
  /** The project's skills and the person's own, read here when a role asks for one. */
  skills?: Skills;
  /** The project's pages, which a role with the look_at_page tool can see. */
  preview?: Preview;
}

type ToolContent = Exclude<Anthropic.ToolResultBlockParam["content"], undefined>;

export function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** One role working on one step: a tool loop on the role's model until it answers. */
export async function runAgent(run: AgentRun): Promise<string> {
  const {
    meter,
    workspace,
    allowedCommands,
    role,
    step,
    seat,
    system,
    prompt,
    tools,
    maxTurns = TURNS,
    onTool,
    ask,
    mcp,
    skills,
    preview,
  } = run;
  const use = async (name: string, input: Record<string, string>): Promise<ToolContent> => {
    if (preview?.owns(name)) {
      onTool?.(name, input);
      return preview.look(input.path, input.width);
    }
    if (skills?.owns(name)) {
      onTool?.(name, input);
      return skills.read(input.name, input.file);
    }
    if (mcp?.owns(name)) {
      // A tool that only looks runs at once; one that may change something waits for the person, like a command.
      const label = mcp.label(name);
      if (!mcp.isReadOnly(name) && !allowedCommands.includes(label)) {
        if (!ask || !(await ask(label, true)))
          return `Error: the person didn't allow ${label}. Do the task without it.`;
      }
      onTool?.(name, input);
      return mcp.call(name, input);
    }
    const command = input.command ?? "";
    if (name === "run_command" && !allowedCommands.includes(command) && ask) {
      // Shown as run only once the person allows it.
      if (!(await ask(command))) return `Error: the person didn't allow ${command}. Do the task without it.`;
      onTool?.(name, input);
      return runTool(workspace, [command], name, input);
    }
    onTool?.(name, input);
    return runTool(workspace, allowedCommands, name, input);
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let cutOff = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await meter.send(role, step, {
      model: seat.model,
      effort: seat.effort,
      system,
      messages,
      tools,
      maxTokens: MAX_TOKENS,
    });
    // A cut-off answer isn't a finished one, and a tool call in it may be half written. The step is asked to
    // carry on once, in smaller steps; a second time ends it, with the work so far kept.
    if (response.stop_reason === "max_tokens") {
      if (cutOff)
        throw new CutOffError(
          "The step's answers kept running past the length one answer can be, so Shoji stopped it. The work so far is kept.",
        );
      cutOff = true;
      messages.push({ role: "user", content: CARRY_ON });
      continue;
    }
    // Thinking blocks go back unchanged, as the API expects.
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((block) => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) return textOf(response);

    // One at a time, since a command may wait for the person.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of uses) {
      const input = call.input as Record<string, string>;
      results.push({ type: "tool_result", tool_use_id: call.id, content: await use(call.name, input) });
    }
    messages.push({ role: "user", content: results });
  }
  return OUT_OF_TURNS;
}
