import Anthropic from "@anthropic-ai/sdk";
import { apiName, MODELS, type ModelId } from "./models";
import type { ModelProvider, ModelRequest } from "./provider";

/** Where Ollama listens unless OLLAMA_HOST, the setting Ollama itself reads, says otherwise. */
export const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

/**
 * Ollama's address from OLLAMA_HOST, which may be a bare host, a host and port, or a whole URL. Ollama listening
 * on every address (0.0.0.0) is reached on this computer's own.
 */
export function ollamaUrl(host: string | undefined): string {
  const given = host?.trim();
  if (!given) return OLLAMA_DEFAULT;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(given) ? given : `http://${given}`);
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1";
    if (!url.port && url.protocol === "http:") url.port = "11434";
    return url.origin;
  } catch {
    return OLLAMA_DEFAULT;
  }
}

/** What went wrong with a call to Ollama, in words the person can act on. */
export function plainOllamaError(error: unknown, model: ModelId): Error {
  if (!(error instanceof Anthropic.APIError)) return error instanceof Error ? error : new Error(String(error));
  const name = apiName(model);
  if (error instanceof Anthropic.APIConnectionError)
    return new Error("Shoji couldn't reach Ollama on this computer. Open Ollama, then try again.");
  const said = (error.error as { error?: { message?: string } } | undefined)?.error?.message?.trim();
  if (error instanceof Anthropic.NotFoundError)
    return new Error(`Ollama doesn't have ${name}. Pull it with "ollama pull ${name}", or pick another model in Stack.`);
  if (said && /does not support tools/i.test(said))
    return new Error(`${MODELS[model]?.label ?? name} can't use tools, which every step needs. Pick another model in Stack.`);
  return new Error(said ? `Ollama turned the request down: ${said}` : error.message);
}

/**
 * Models on the person's own computer, through Ollama's Anthropic-compatible API. Ollama has no prompt caching
 * and reads no effort, so neither is sent.
 */
export class OllamaProvider implements ModelProvider {
  private client: Anthropic;

  constructor(baseURL = OLLAMA_DEFAULT) {
    // Ollama checks no key, but the client needs one.
    this.client = new Anthropic({ apiKey: "ollama", baseURL, maxRetries: 1 });
  }

  async send({ model, system, messages, tools, maxTokens }: ModelRequest) {
    try {
      return await this.client.messages.create({
        model: apiName(model),
        max_tokens: maxTokens,
        system,
        messages,
        tools,
      });
    } catch (error) {
      throw plainOllamaError(error, model);
    }
  }
}
