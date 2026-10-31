import type { Comparison } from "./compare";
import type { McpEvent } from "./mcp";
import type { Effort, ModelId } from "./models";
import type { Role } from "./stack";

/** One model call, as logged for receipts. */
export interface CallRecord {
  role: Role;
  /** The pipeline step that made the call; a fix round is its own step. */
  step: string;
  model: ModelId;
  effort: Effort;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  cost: number;
  seconds: number;
}

export interface CheckResult {
  command: string;
  ok: boolean;
  output: string;
  /** The command's program couldn't be found, so the check never ran. */
  missing?: boolean;
  /** The check failed before Shoji changed anything too, so it isn't the thread's to fix. */
  failedBefore?: boolean;
  /** The tests or errors its output names as failing, when Shoji can read them. */
  failing?: string[];
  /** In a check that failed before Shoji started, the failures that are new since then. */
  newFailures?: string[];
}

export type RuntimeEvent =
  | { type: "step"; step: string; role: Role; model: ModelId; status: "running" }
  /** `output` is what the step wrote: the scout's brief, the plan, the builder's summary or the review. */
  | { type: "step"; step: string; role: Role; model: ModelId; status: "done"; output: string }
  /** A tool call. `target` is the file, folder, pattern or command it was used on. */
  | { type: "tool"; step: string; tool: string; target: string }
  | { type: "call"; call: CallRecord }
  | { type: "checks"; step: string; results: CheckResult[] }
  /** A step wants a command that isn't a check and that the person hasn't allowed, or with `tool`, an MCP tool
   *  that may change something, named as "server: tool". It waits for an answer. */
  | { type: "ask"; step: string; command: string; tool?: true }
  | { type: "answer"; step: string; command: string; allowed: boolean }
  | { type: "escalate"; step: string; from: ModelId; to: ModelId; reason: string }
  | { type: "result"; result: ThreadResult }
  /** After a run that changed pages Build looked at: screenshots of each before the work and after it. */
  | { type: "compare"; status: "running" }
  | ({ type: "compare"; status: "done" } & Comparison)
  /** An MCP server the person added: how many tools it gave, or why it couldn't be reached. */
  | McpEvent;

export interface ThreadResult {
  /** planned: the run stopped after the plan, for the person to build or change it. answered: the
   *  run answered the person's question and changed nothing. */
  status: "ready" | "needs-work" | "stopped" | "failed" | "planned" | "answered";
  /** Why the thread stopped or failed, in plain words. */
  reason?: string;
  plan: string;
  diff: string;
  review: string;
  checks: CheckResult[];
  /** Checks that failed before the thread's first build, which later runs leave alone too. */
  failingBefore?: string[];
  /** The failures those checks named then, so a later run can still tell a new one apart. */
  failingTestsBefore?: string[];
  escalated: boolean;
  cost: number;
  costByRole: Record<Role, number>;
}

export type Emit = (event: RuntimeEvent) => void;
