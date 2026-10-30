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
}

export type RuntimeEvent =
  | { type: "step"; step: string; role: Role; model: ModelId; status: "running" }
  /** `output` is what the step wrote: the scout's brief, the plan, the builder's summary or the review. */
  | { type: "step"; step: string; role: Role; model: ModelId; status: "done"; output: string }
  /** A tool call. `target` is the file, folder, pattern or command it was used on. */
  | { type: "tool"; step: string; tool: string; target: string }
  | { type: "call"; call: CallRecord }
  | { type: "checks"; step: string; results: CheckResult[] }
  | { type: "escalate"; step: string; from: ModelId; to: ModelId; reason: string }
  | { type: "result"; result: ThreadResult };

export interface ThreadResult {
  /** planned: the run stopped after the plan, for the person to build or change it. */
  status: "ready" | "needs-work" | "stopped" | "failed" | "planned";
  /** Why the thread stopped or failed, in plain words. */
  reason?: string;
  plan: string;
  diff: string;
  review: string;
  checks: CheckResult[];
  /** Checks that failed before the thread's first build, which later runs leave alone too. */
  failingBefore?: string[];
  escalated: boolean;
  cost: number;
  costByRole: Record<Role, number>;
}

export type Emit = (event: RuntimeEvent) => void;
