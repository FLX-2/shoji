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
  status: "ready" | "needs-work" | "stopped" | "failed";
  /** Why the thread stopped or failed, in plain words. */
  reason?: string;
  plan: string;
  diff: string;
  review: string;
  checks: CheckResult[];
  escalated: boolean;
  cost: number;
  costByRole: Record<Role, number>;
}

export type Emit = (event: RuntimeEvent) => void;
