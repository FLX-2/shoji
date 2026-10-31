import type Anthropic from "@anthropic-ai/sdk";
import type { Mcp } from "./mcp";
import type { Meter } from "./meter";
import type { Skills } from "./skills";
import type { Role, Seat } from "./stack";
import { runTool } from "./tools";
import type { Workspace } from "./workspace";

export const MAX_TOKENS = 16000;

/** What a step answers when it used every turn without finishing. */
export const OUT_OF_TURNS = "(The step ran out of turns before it finished.)";

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
}

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
    maxTurns = 12,
    onTool,
    ask,
    mcp,
    skills,
  } = run;
  const use = async (name: string, input: Record<string, string>) => {
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

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await meter.send(role, step, {
      model: seat.model,
      effort: seat.effort,
      system,
      messages,
      tools,
      maxTokens: MAX_TOKENS,
    });
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
