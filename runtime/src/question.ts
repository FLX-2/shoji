import { OUT_OF_TURNS, runAgent } from "./agent";
import type { Emit, ThreadResult } from "./events";
import { diffOf } from "./git";
import { projectInstructions } from "./instructions";
import { type Mcp, NO_MCP } from "./mcp";
import { BudgetExceeded, Meter, RefusedError } from "./meter";
import * as prompts from "./prompts";
import type { ModelProvider } from "./provider";
import { ROLES, type Role, type Seat } from "./stack";
import { READ_TOOLS } from "./tools";
import type { Workspace } from "./workspace";

/** Most of the diff the answer sees; the rest it can read from the files. */
const MOST_DIFF_CHARS = 40_000;

export interface QuestionInput {
  task: string;
  /** The thread's latest plan. */
  plan: string;
  question: string;
  /** The stack's scout seat, which reads the code and answers. */
  seat: Seat;
  provider: ModelProvider;
  workspace: Workspace;
  /** Hard spending cap, in dollars. */
  cap: number;
  emit: Emit;
  /** The person's MCP servers; the answer uses only the tools that look. */
  mcp?: Mcp;
}

/**
 * Answers the person's question about a thread's work, reading the project but changing nothing.
 * Ends with an "answered" result, which leaves the thread where it was.
 */
export async function answerQuestion(input: QuestionInput): Promise<ThreadResult> {
  const { task, plan, question, seat, workspace, emit } = input;
  // Only the tools that look: an answer changes nothing.
  const mcp = input.mcp ?? NO_MCP;
  const meter = new Meter(input.provider, emit, input.cap);
  const step = "answer";
  const finish = (status: ThreadResult["status"], reason?: string): ThreadResult => {
    const costByRole = Object.fromEntries(
      ROLES.map((role) => [role, meter.calls.filter((c) => c.role === role).reduce((sum, c) => sum + c.cost, 0)]),
    ) as Record<Role, number>;
    const result: ThreadResult = {
      status,
      reason,
      plan: "",
      diff: "",
      review: "",
      checks: [],
      escalated: false,
      cost: meter.spent,
      costByRole,
    };
    emit({ type: "result", result });
    return result;
  };

  try {
    emit({ type: "step", step, role: "scout", model: seat.model, status: "running" });
    const diff = diffOf(workspace.root, (file) => workspace.isPrivate(file));
    const shown =
      diff.length > MOST_DIFF_CHARS ? `${diff.slice(0, MOST_DIFF_CHARS)}\n(The rest of the diff was cut.)` : diff;
    const answer = await runAgent({
      meter,
      workspace,
      allowedCommands: [],
      role: "scout",
      step,
      seat,
      system: prompts.QUESTION,
      prompt: `Task: ${task}${projectInstructions(workspace)}\n\nPlan:\n${plan}\n\nThe work so far:\n${shown || "(no changes yet)"}\n\nThe person asks: ${question}`,
      tools: [...READ_TOOLS, ...mcp.readOnly],
      mcp,
      maxTurns: 8,
      onTool: (tool, input) =>
        emit({
          type: "tool",
          step,
          tool,
          target: mcp.owns(tool) ? mcp.label(tool) : (input.path ?? input.pattern ?? ""),
        }),
    });
    emit({ type: "step", step, role: "scout", model: seat.model, status: "done", output: answer });
    if (!answer || answer === OUT_OF_TURNS) return finish("failed", "The answer ran out of turns before it finished.");
    return finish("answered");
  } catch (error) {
    if (error instanceof BudgetExceeded) return finish("stopped", error.message);
    if (error instanceof RefusedError) return finish("failed", error.message);
    return finish("failed", error instanceof Error ? error.message : String(error));
  }
}
