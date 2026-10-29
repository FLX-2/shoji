import type Anthropic from "@anthropic-ai/sdk";
import type { Meter } from "./meter";
import type { Role, Seat } from "./stack";
import { runTool } from "./tools";
import type { Workspace } from "./workspace";

export const MAX_TOKENS = 16000;

export interface AgentRun {
  meter: Meter;
  workspace: Workspace;
  allowedCommands: string[];
  role: Role;
  step: string;
  seat: Seat;
  system: string;
  prompt: string;
  tools?: Anthropic.Tool[];
  maxTurns?: number;
  /** Called before each tool runs, so the app can show the work as it happens. */
  onTool?: (name: string, input: Record<string, string>) => void;
}

export function textOf(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** One role working on one step: a tool loop on the role's model until it answers. */
export async function runAgent(run: AgentRun): Promise<string> {
  const { meter, workspace, allowedCommands, role, step, seat, system, prompt, tools, maxTurns = 12, onTool } = run;
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

    messages.push({
      role: "user",
      content: uses.map((use) => {
        const input = use.input as Record<string, string>;
        onTool?.(use.name, input);
        return {
          type: "tool_result" as const,
          tool_use_id: use.id,
          content: runTool(workspace, allowedCommands, use.name, input),
        };
      }),
    });
  }
  return "(The step ran out of turns before it finished.)";
}
