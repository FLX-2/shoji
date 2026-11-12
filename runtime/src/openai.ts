import type Anthropic from "@anthropic-ai/sdk";
import { apiName, MODELS, type Effort, type ModelId } from "./models";
import { KeyRejectedError, type ModelProvider, type ModelRequest } from "./provider";

/**
 * OpenAI's models through its Responses API: on the person's ChatGPT plan (Sign in with ChatGPT) or on their
 * OpenAI API key. The roles speak Anthropic's message format, so each call is translated there and back.
 */

export const OPENAI_API = "https://api.openai.com/v1";

/** On a plan every tool goes in one namespace: that route asks for tools grouped so, and calls come back in it.
 *  An API key's route takes them flat. */
export const NAMESPACE = "shoji";

/** A plan has run out for now, as a thread's limit does: the thread stops and can carry on later. */
export class PlanLimitError extends Error {}

/** OpenAI's reasoning efforts. Shoji's two highest have no match everywhere, so they ask for OpenAI's highest. */
const EFFORT: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

type Item = Record<string, unknown>;

const dataUrl = (source: { media_type: string; data: string }) => `data:${source.media_type};base64,${source.data}`;

/** A user's blocks as Responses content: text, images and PDFs. */
function userContent(blocks: Anthropic.ContentBlockParam[]): Item[] {
  return blocks.flatMap((block): Item[] => {
    if (block.type === "text") return [{ type: "input_text", text: block.text }];
    if (block.type === "image" && block.source.type === "base64")
      return [{ type: "input_image", image_url: dataUrl(block.source) }];
    if (block.type === "document" && block.source.type === "base64")
      return [{ type: "input_file", filename: "attached.pdf", file_data: dataUrl(block.source) }];
    return [];
  });
}

/** What a tool answered: plain text, or text and images in order. */
function toolOutput(content: Anthropic.ToolResultBlockParam["content"]): string | Item[] {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return userContent(content as Anthropic.ContentBlockParam[]);
}

/** The conversation as Responses input items. Thinking stays behind: it isn't stored, so it can't be sent back. */
export function toInput(messages: Anthropic.MessageParam[], grouped = true): Item[] {
  const items: Item[] = [];
  for (const message of messages) {
    const blocks: Anthropic.ContentBlockParam[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (message.role === "user") {
      for (const block of blocks) {
        if (block.type === "tool_result")
          items.push({ type: "function_call_output", call_id: block.tool_use_id, output: toolOutput(block.content) });
      }
      const content = userContent(blocks.filter((b) => b.type !== "tool_result"));
      if (content.length) items.push({ role: "user", content });
    } else {
      for (const block of blocks) {
        if (block.type === "text" && block.text)
          items.push({ role: "assistant", content: [{ type: "output_text", text: block.text }] });
        else if (block.type === "tool_use")
          items.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            ...(grouped && { namespace: NAMESPACE }),
            arguments: JSON.stringify(block.input ?? {}),
          });
      }
    }
  }
  return items;
}

/** The request body for one call. A plan sets no output limit, which its route doesn't take, and groups the tools. */
export function toRequest(request: ModelRequest, plan: boolean, drop: string[] = []): Record<string, unknown> {
  const tools = request.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.input_schema,
  }));
  const body: Record<string, unknown> = {
    model: apiName(request.model),
    instructions: request.system,
    input: toInput(request.messages, plan),
    reasoning: { effort: EFFORT[request.effort] },
    store: false,
    stream: true,
  };
  if (tools?.length)
    body.tools = plan
      ? [{ type: "namespace", name: NAMESPACE, description: "Shoji's tools for working in the person's project.", tools }]
      : tools;
  if (!plan) body.max_output_tokens = request.maxTokens;
  for (const field of drop) delete body[field];
  return body;
}

interface Output {
  type: string;
  content?: { type: string; text?: string; refusal?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface ResponsesResult {
  status?: string;
  output?: Output[];
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/** A finished response as the Anthropic message the roles read. */
export function toMessage(response: ResponsesResult, model: ModelId): Anthropic.Message {
  const content: Record<string, unknown>[] = [];
  let refused = false;
  for (const item of response.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) content.push({ type: "text", text: part.text, citations: null });
        if (part.type === "refusal") refused = true;
      }
    } else if (item.type === "function_call") {
      let input: unknown = {};
      try {
        input = JSON.parse(item.arguments || "{}");
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: item.call_id, name: item.name, input, caller: { type: "direct" } });
    }
  }
  const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
  const called = content.some((block) => block.type === "tool_use");
  return {
    id: `resp_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    // Cut off comes before a tool call: the call's arguments may have been cut off with it.
    stop_reason: refused
      ? "refusal"
      : response.incomplete_details?.reason === "max_output_tokens"
        ? "max_tokens"
        : called
          ? "tool_use"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (response.usage?.input_tokens ?? 0) - cached),
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

/** Why a connection failed, in the system's own short words, such as ECONNRESET. */
function reason(cause: unknown): string {
  const inner = (cause as { cause?: { code?: string; message?: string } })?.cause;
  const code = (cause as { code?: string })?.code ?? inner?.code;
  if (typeof code === "string" && code) return code;
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 80) || "no answer";
}

/** An error OpenAI sent, before or during the answer. */
export class OpenAIError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
    message: string,
    readonly param: string | null = null,
  ) {
    super(message);
  }
}

/** Reads a streamed answer to its end. Only a completed (or cut-short) response counts; a failure, even one
 *  that arrives partway, is thrown. */
export async function readStream(body: ReadableStream<Uint8Array>): Promise<ResponsesResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let finished: ResponsesResult | null = null;
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event: { type?: string; response?: ResponsesResult & { error?: { code?: string; message?: string } }; code?: string; message?: string; error?: { code?: string; message?: string } };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === "response.completed" || event.type === "response.incomplete") finished = event.response ?? {};
    else if (event.type === "response.failed") {
      const error = event.response?.error;
      throw new OpenAIError(null, error?.code ?? null, error?.message ?? "The answer failed partway.");
    } else if (event.type === "error") {
      const error = event.error ?? event;
      throw new OpenAIError(null, error.code ?? null, error.message ?? "The answer failed partway.");
    }
  };
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      take(buffer.slice(0, end).replace(/\r$/, ""));
      buffer = buffer.slice(end + 1);
    }
  }
  take(buffer.trim());
  if (!finished) throw new OpenAIError(null, "interrupted", "The answer stopped before it finished.");
  return finished;
}

export interface OpenAIOptions {
  /** On the person's ChatGPT plan, rather than an API key. */
  plan: boolean;
  /** A current access token or API key. A plan's token is asked for before each call, since it lasts an hour. */
  credential: (fresh?: boolean) => Promise<string>;
  baseURL?: string;
  /** Who answers on a key, as the person knows them: OpenAI unless said otherwise, such as OpenRouter. */
  service?: string;
  /** Headers every call carries beyond the key, such as the app's name for OpenRouter. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** How long to wait before trying a busy service again, in ms; tests make it 0. */
  backoff?: number;
}

const OPTIONAL = ["reasoning", "max_output_tokens"];

/** OpenAI's models, on a plan or a key. */
export class OpenAIProvider implements ModelProvider {
  constructor(private options: OpenAIOptions) {}

  async send(request: ModelRequest): Promise<Anthropic.Message> {
    const drop: string[] = [];
    let refreshed = false;
    let busy = 0;
    let dropped = 0;
    for (;;) {
      try {
        return await this.once(request, drop, refreshed);
      } catch (error) {
        if (!(error instanceof OpenAIError)) throw this.plain(error, request.model);
        // A field this model or route doesn't take is left out once, rather than failing the step.
        const field = OPTIONAL.find((f) => error.param?.startsWith(f));
        if (error.code?.endsWith("unsupported_capability") || (error.status === 400 && field)) {
          if (field && !drop.includes(field)) {
            drop.push(field);
            continue;
          }
        }
        if (error.status === 401 && this.options.plan && !refreshed) {
          refreshed = true;
          continue;
        }
        // A connection that drops before or during the answer is tried again, as Anthropic's client does: a
        // connection kept open from the call before can be closed by the far end by the time it's reused.
        if ((error.code === "unreachable" || error.code === "interrupted" || ((error.status ?? 0) >= 500 && error.status !== 503)) && dropped < 2) {
          dropped++;
          await new Promise((done) => setTimeout(done, (this.options.backoff ?? 4000) * dropped * 0.25));
          continue;
        }
        const unavailable = error.status === 503 || /usage_unavailable|user_unavailable/.test(error.code ?? "");
        if (unavailable && busy < 2) {
          busy++;
          await new Promise((done) => setTimeout(done, (this.options.backoff ?? 4000) * busy));
          continue;
        }
        throw this.plain(error, request.model);
      }
    }
  }

  private async once(request: ModelRequest, drop: string[], fresh: boolean): Promise<Anthropic.Message> {
    const credential = await this.options.credential(fresh);
    let answer: Response;
    try {
      answer = await (this.options.fetch ?? fetch)(`${this.options.baseURL ?? OPENAI_API}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          accept: "text/event-stream",
          ...this.options.headers,
        },
        body: JSON.stringify(toRequest(request, this.options.plan, drop)),
      });
    } catch (cause) {
      throw new OpenAIError(null, "unreachable", reason(cause));
    }
    if (!answer.ok || !answer.body) {
      const said = (await answer.json().catch(() => ({}))) as { error?: { code?: string; message?: string; param?: string } };
      throw new OpenAIError(
        answer.status,
        // OpenRouter's codes are numbers, the HTTP status again; only OpenAI's words say more.
        typeof said.error?.code === "string" ? said.error.code : null,
        said.error?.message ?? answer.statusText,
        said.error?.param ?? null,
      );
    }
    let result: ResponsesResult;
    try {
      result = await readStream(answer.body);
    } catch (cause) {
      if (cause instanceof OpenAIError) throw cause;
      // The connection closed partway through the answer.
      throw new OpenAIError(null, "interrupted", reason(cause));
    }
    return toMessage(result, request.model);
  }

  /** What went wrong, in words the person can act on. */
  private plain(error: unknown, model: ModelId): Error {
    if (!(error instanceof OpenAIError)) return error instanceof Error ? error : new Error(String(error));
    const name = MODELS[model]?.label ?? apiName(model);
    const code = error.code ?? "";
    const plan = this.options.plan;
    const who = plan ? "ChatGPT" : (this.options.service ?? "OpenAI");
    if (code === "unreachable")
      return new Error(`Shoji couldn't reach ${who} after 3 tries (${error.message}). Check your internet connection, then try again.`);
    if (code === "subscription_sharing_usage_limit_exceeded")
      return new PlanLimitError(
        "Your ChatGPT plan has reached its limit for Shoji for now. Manage usage in ChatGPT's settings, then carry on.",
      );
    if (code === "subscription_sharing_user_not_eligible")
      return new Error("Your ChatGPT plan can't be used in other apps. Plus and Pro plans can.");
    if (plan && (error.status === 401 || code === "subscription_sharing_invalid_user" || code === "signed_out"))
      return new KeyRejectedError("ChatGPT signed Shoji out. Sign in with ChatGPT again in Settings.");
    if (!plan && error.status === 401) return new KeyRejectedError(`${who} didn't accept your key. Check it in Settings.`);
    if (!plan && (code === "insufficient_quota" || error.status === 402))
      return new Error(`Your ${who} account is out of credit. Add credit on ${who}'s site, then try again.`);
    if (error.status === 404 || code === "model_not_found")
      return new Error(`${plan ? "Your ChatGPT plan" : who} doesn't offer ${name} here. Pick another model in Stack.`);
    if (error.status === 429) return new Error(`${who} is limiting how fast Shoji can send. Wait a minute, then try again.`);
    if (error.status === 503 || /unavailable/.test(code))
      return new Error(`${who} couldn't take the request right now. Try again in a few minutes.`);
    if (code === "interrupted") return new Error(`${name}'s answer stopped partway. Try again.`);
    return new Error(`${who} turned the request down: ${error.message}`);
  }
}
