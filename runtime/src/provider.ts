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

export const KEY_REJECTED = "Anthropic didn't accept your API key. Check it in Settings.";

export class KeyRejectedError extends Error {}

export class AnthropicProvider implements ModelProvider {
  private client: Anthropic;

  constructor(apiKey: string, baseURL = "https://api.anthropic.com") {
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  async send({ model, effort, system, messages, tools, maxTokens }: ModelRequest) {
    try {
      return await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
        output_config: { effort },
        // Each role keeps one model for a whole step, so its cache stays warm.
        cache_control: { type: "ephemeral" },
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new KeyRejectedError(KEY_REJECTED);
      throw error;
    }
  }
}
