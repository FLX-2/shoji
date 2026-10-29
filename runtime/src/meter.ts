import type Anthropic from "@anthropic-ai/sdk";
import { costOf, worstCaseOutput, type ModelId } from "./models";
import type { CallRecord, Emit } from "./events";
import type { ModelProvider, ModelRequest } from "./provider";
import type { Role } from "./stack";

export class BudgetExceeded extends Error {}

export class RefusedError extends Error {}

/** Sends every call through one place, so each is costed, logged and held to the cap. */
export class Meter {
  spent = 0;
  readonly calls: CallRecord[] = [];

  constructor(
    private provider: ModelProvider,
    private emit: Emit,
    /** Hard cap in dollars for this thread. */
    readonly cap: number,
  ) {}

  async send(role: Role, step: string, request: ModelRequest): Promise<Anthropic.Message> {
    const worst = worstCaseOutput(request.model, request.maxTokens);
    if (this.spent + worst > this.cap) {
      throw new BudgetExceeded(
        `Stopped at $${this.spent.toFixed(2)}: the next call could pass the $${this.cap.toFixed(2)} limit.`,
      );
    }
    const started = Date.now();
    const response = await this.provider.send(request);
    this.record(role, step, request.model, request, response, started);
    if (response.stop_reason === "refusal") {
      throw new RefusedError(`${request.model} declined the ${step} step.`);
    }
    return response;
  }

  private record(
    role: Role,
    step: string,
    model: ModelId,
    request: ModelRequest,
    response: Anthropic.Message,
    started: number,
  ) {
    const usage = response.usage;
    const call: CallRecord = {
      role,
      step,
      model,
      effort: request.effort,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cost: costOf(model, usage),
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
    this.spent += call.cost;
    this.calls.push(call);
    this.emit({ type: "call", call });
  }
}
