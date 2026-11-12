import type Anthropic from "@anthropic-ai/sdk";
import { apiName, MODELS, type Effort, type ModelId } from "./models";
import { KeyRejectedError, type ModelProvider, type ModelRequest } from "./provider";

/**
 * A model behind an OpenAI-style Chat Completions API, such as Gemini's on a Google AI Studio key. The roles speak
 * Anthropic's message format, so each call is translated there and back.
 */

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Chat Completions takes three efforts. Shoji's two highest ask for the highest. */
const EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

type Item = Record<string, unknown>;

const dataUrl = (source: { media_type: string; data: string }) => `data:${source.media_type};base64,${source.data}`;

/** A user's blocks as Chat Completions content: text and images. */
function userParts(blocks: Anthropic.ContentBlockParam[]): Item[] {
  return blocks.flatMap((block): Item[] => {
    if (block.type === "text") return [{ type: "text", text: block.text }];
    if (block.type === "image" && block.source.type === "base64")
      return [{ type: "image_url", image_url: { url: dataUrl(block.source) } }];
    return [];
  });
}

/** What a tool answered, as text. A tool message carries only text, so images it returned follow as a user turn. */
function toolText(content: Anthropic.ToolResultBlockParam["content"]): { text: string; images: Item[] } {
  if (content === undefined) return { text: "", images: [] };
  if (typeof content === "string") return { text: content, images: [] };
  const parts = userParts(content as Anthropic.ContentBlockParam[]);
  return {
    text: parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n"),
    images: parts.filter((p) => p.type === "image_url"),
  };
}

/** The conversation as Chat Completions messages, after the system prompt. */
export function toMessages(system: string, messages: Anthropic.MessageParam[]): Item[] {
  const out: Item[] = [{ role: "system", content: system }];
  for (const message of messages) {
    const blocks: Anthropic.ContentBlockParam[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (message.role === "user") {
      const images: Item[] = [];
      for (const block of blocks) {
        if (block.type !== "tool_result") continue;
        const answered = toolText(block.content);
        out.push({ role: "tool", tool_call_id: block.tool_use_id, content: answered.text });
        images.push(...answered.images);
      }
      const content = [...userParts(blocks.filter((b) => b.type !== "tool_result")), ...images];
      if (content.length) out.push({ role: "user", content });
    } else {
      const text = blocks
        .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = blocks
        .filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use")
        .map((b) => {
          // Gemini 3 signs its tool calls and wants the signature back with each one; it rides on the block.
          const extra = (b as { extra_content?: unknown }).extra_content;
          return {
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
            ...(extra !== undefined && { extra_content: extra }),
          };
        });
      if (!text && !calls.length) continue;
      out.push({ role: "assistant", content: text || null, ...(calls.length && { tool_calls: calls }) });
    }
  }
  return out;
}

/** The request body for one call, without the fields named in `drop`. */
export function toRequest(request: ModelRequest, drop: string[] = []): Item {
  const body: Item = {
    model: apiName(request.model),
    messages: toMessages(request.system, request.messages),
    max_tokens: request.maxTokens,
    reasoning_effort: EFFORT[request.effort],
  };
  if (request.tools?.length)
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description ?? "", parameters: tool.input_schema },
    }));
  for (const field of drop) delete body[field];
  return body;
}

export interface ChatResult {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** An answer as the Anthropic message the roles read. */
export function toMessage(result: ChatResult, model: ModelId): Anthropic.Message {
  const choice = result.choices?.[0];
  const content: Record<string, unknown>[] = [];
  if (choice?.message?.content) content.push({ type: "text", text: choice.message.content, citations: null });
  (choice?.message?.tool_calls ?? []).forEach((call, i) => {
    let input: unknown = {};
    try {
      input = JSON.parse(call.function?.arguments || "{}");
    } catch {
      input = {};
    }
    // Some models leave a call's id out. The tool's answer needs one to go back to it.
    content.push({
      type: "tool_use",
      id: call.id || `call_${Date.now()}_${i}`,
      name: call.function?.name,
      input,
      caller: { type: "direct" },
      ...(call.extra_content !== undefined && { extra_content: call.extra_content }),
    });
  });
  const cached = result.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const called = content.some((block) => block.type === "tool_use");
  return {
    id: `chat_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: choice?.message?.refusal
      ? "refusal"
      : called
        ? "tool_use"
        : choice?.finish_reason === "length"
          ? "max_tokens"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (result.usage?.prompt_tokens ?? 0) - cached),
      output_tokens: result.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

/** An error the service sent, or a connection that failed. */
export class ChatError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatOptions {
  /** Who answers, as the person knows them, such as Gemini. */
  service: string;
  baseURL: string;
  key: string;
  fetch?: typeof fetch;
  /** How long to wait before trying a busy service again, in ms; tests make it 0. */
  backoff?: number;
}

/** Fields a model may not take. One that's turned down is left out once, rather than failing the step. */
const OPTIONAL = ["reasoning_effort", "max_tokens"];

/** A service that speaks Chat Completions on the person's key. */
export class ChatProvider implements ModelProvider {
  constructor(private options: ChatOptions) {}

  async send(request: ModelRequest): Promise<Anthropic.Message> {
    const drop: string[] = [];
    let tries = 0;
    for (;;) {
      try {
        return await this.once(request, drop);
      } catch (error) {
        if (!(error instanceof ChatError)) throw error;
        const field = OPTIONAL.find((f) => !drop.includes(f) && error.message.includes(f));
        if (error.status === 400 && field) {
          drop.push(field);
          continue;
        }
        // A dropped connection or a busy service is tried twice more, as Anthropic's client does.
        if ((error.status === null || error.status >= 500) && tries < 2) {
          tries++;
          await new Promise((done) => setTimeout(done, (this.options.backoff ?? 4000) * tries * 0.5));
          continue;
        }
        throw this.plain(error, request.model);
      }
    }
  }

  private async once(request: ModelRequest, drop: string[]): Promise<Anthropic.Message> {
    let answer: Response;
    try {
      answer = await (this.options.fetch ?? fetch)(`${this.options.baseURL}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.key}`, "content-type": "application/json" },
        body: JSON.stringify(toRequest(request, drop)),
      });
    } catch {
      throw new ChatError(null, "unreachable");
    }
    // Google answers an error as a list holding one error; others answer it bare.
    const said = (await answer.json().catch(() => null)) as (ChatResult & { error?: { message?: string } }) | { error?: { message?: string } }[] | null;
    const body = Array.isArray(said) ? said[0] : said;
    if (!answer.ok || !body || body.error)
      throw new ChatError(answer.ok ? 500 : answer.status, body?.error?.message ?? answer.statusText);
    return toMessage(body as ChatResult, request.model);
  }

  /** What went wrong, in words the person can act on. */
  private plain(error: ChatError, model: ModelId): Error {
    const who = this.options.service;
    const name = MODELS[model]?.label ?? apiName(model);
    if (error.status === null)
      return new Error(`Shoji couldn't reach ${who} after 3 tries. Check your internet connection, then try again.`);
    if (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message)))
      return new KeyRejectedError(`${who} didn't accept your key. Check it in Settings.`);
    if (error.status === 404) return new Error(`${who} doesn't offer ${name} to your key. Pick another model in Stack.`);
    if (error.status === 429)
      return new Error(
        MODELS[model]?.billing === "free"
          ? `${who}'s free tier has reached its limit for now. Wait a while or until tomorrow, or pick another model in Stack.`
          : `${who} is limiting how fast Shoji can send. Wait a minute, then try again.`,
      );
    if (error.status >= 500) return new Error(`${who} couldn't take the request right now. Try again in a few minutes.`);
    return new Error(`${who} turned the request down: ${error.message}`);
  }
}
