import Anthropic from "@anthropic-ai/sdk";
import type { Effort, ModelId } from "./models";

export interface ModelRequest {
  model: ModelId;
  effort: Effort;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens: number;
}

/** Where model calls go. M1 talks to Anthropic only; other providers arrive with the M2 gateway. */
export interface ModelProvider {
  send(request: ModelRequest): Promise<Anthropic.Message>;
}

export class AnthropicProvider implements ModelProvider {
  private client: Anthropic;

  constructor(apiKey: string, baseURL = "https://api.anthropic.com") {
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  send({ model, effort, system, messages, tools, maxTokens }: ModelRequest) {
    return this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools,
      output_config: { effort },
      // Each role keeps one model for a whole step, so its cache stays warm.
      cache_control: { type: "ephemeral" },
    });
  }
}
