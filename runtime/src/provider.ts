import Anthropic from "@anthropic-ai/sdk";
import { MODELS, type Effort, type ModelId } from "./models";

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

/**
 * What went wrong with a call to Anthropic, in words the person can act on, in place of the SDK's
 * status code and JSON. The SDK has already retried what can be retried by the time this is read.
 */
export function plainApiError(error: unknown, model: ModelId): Error {
  if (!(error instanceof Anthropic.APIError)) return error instanceof Error ? error : new Error(String(error));
  if (error instanceof Anthropic.AuthenticationError) return new KeyRejectedError(KEY_REJECTED);
  if (error instanceof Anthropic.APIConnectionError)
    return new Error("Shoji couldn't reach Anthropic. Check your internet connection, then try again.");
  const said = (error.error as { error?: { message?: string } } | undefined)?.error?.message?.trim();
  if (said && /credit balance/i.test(said))
    return new Error("Your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again.");
  if (error instanceof Anthropic.PermissionDeniedError)
    return new Error("Anthropic didn't let your API key do that. Check the key's workspace in the Anthropic Console.");
  if (error instanceof Anthropic.NotFoundError)
    return new Error(
      `Anthropic doesn't offer ${MODELS[model]?.label ?? model} to your API key. Pick another model in Stack.`,
    );
  if (error instanceof Anthropic.RateLimitError)
    return new Error("Anthropic is limiting how fast your API key can send. Wait a minute, then try again.");
  if (error.status === 529 || error.type === "overloaded_error")
    return new Error("Anthropic's API is busy right now. Try again in a few minutes.");
  if (error.status !== undefined && error.status >= 500)
    return new Error("Anthropic's API had a problem on its side. Try again in a few minutes.");
  return new Error(said ? `Anthropic turned the request down: ${said}` : error.message);
}

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
      throw plainApiError(error, model);
    }
  }
}
