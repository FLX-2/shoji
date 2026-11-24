import type Anthropic from "@anthropic-ai/sdk";
import { apiName, MODELS, type ModelId } from "./models";
import type { ModelProvider, ModelRequest } from "./provider";

/** Where Ollama listens unless OLLAMA_HOST, the setting Ollama itself reads, says otherwise. */
export const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

/**
 * How much a step can hold, in tokens. Ollama gives a model as little as 4,000 on a computer with under 24 GB of
 * graphics memory, which a coding step outgrows in its first few turns, and Ollama then drops the start of the
 * conversation without a word. Ollama's own guide asks for at least 64,000 for coding tools.
 */
export const OLLAMA_CONTEXT = 65_536;

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

/** The longest context a model was made for, from what /api/show says about it, or null when it doesn't say. */
export function contextOf(shown: { model_info?: Record<string, unknown> } | null | undefined): number | null {
  const info = shown?.model_info ?? {};
  const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
  const length = key ? Number(info[key]) : NaN;
  return Number.isFinite(length) && length > 0 ? length : null;
}

/** The context a step on this model gets: Shoji's room for a step, or less when the model was made for less. */
export const stepContext = (made: number | null) => Math.min(made ?? OLLAMA_CONTEXT, OLLAMA_CONTEXT);

type Item = Record<string, unknown>;

/** A tool's answer, or a user's turn, as text and the images that go with it. */
function textAndImages(content: string | Anthropic.ContentBlockParam[] | undefined): { text: string; images: string[] } {
  if (content === undefined) return { text: "", images: [] };
  if (typeof content === "string") return { text: content, images: [] };
  const text: string[] = [];
  const images: string[] = [];
  for (const block of content) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "image" && block.source.type === "base64") images.push(block.source.data);
  }
  return { text: text.join("\n"), images };
}

/** The conversation as Ollama's chat messages, after the system prompt. Ollama's tool calls carry no ids, so a
 *  tool's answer goes back by the tool's name, in the order the calls were made. */
export function toOllamaMessages(system: string, messages: Anthropic.MessageParam[]): Item[] {
  const out: Item[] = [{ role: "system", content: system }];
  const names = new Map<string, string>();
  for (const message of messages) {
    const blocks: Anthropic.ContentBlockParam[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (message.role === "user") {
      const pictures: string[] = [];
      for (const block of blocks) {
        if (block.type !== "tool_result") continue;
        const answered = textAndImages(block.content as Anthropic.ContentBlockParam[] | string | undefined);
        out.push({ role: "tool", content: answered.text, tool_name: names.get(block.tool_use_id) ?? "" });
        pictures.push(...answered.images);
      }
      const said = textAndImages(blocks.filter((b) => b.type !== "tool_result"));
      const images = [...said.images, ...pictures];
      if (said.text || images.length) out.push({ role: "user", content: said.text, ...(images.length && { images }) });
    } else {
      const text = blocks
        .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = blocks
        .filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use")
        .map((b) => {
          names.set(b.id, b.name);
          return { function: { name: b.name, arguments: b.input ?? {} } };
        });
      if (!text && !calls.length) continue;
      out.push({ role: "assistant", content: text, ...(calls.length && { tool_calls: calls }) });
    }
  }
  return out;
}

/** The request body for one call, with room for `answer` tokens of answer. Ollama reads no effort and caches the
 *  start of a prompt by itself. */
export function toOllamaRequest(request: ModelRequest, context: number, answer = request.maxTokens): Item {
  return {
    model: apiName(request.model),
    messages: toOllamaMessages(request.system, request.messages),
    ...(request.tools?.length && {
      tools: request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description ?? "", parameters: tool.input_schema },
      })),
    }),
    stream: false,
    options: { num_ctx: context, num_predict: answer },
  };
}

export interface OllamaAnswer {
  message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** An answer as the Anthropic message the roles read. */
export function fromOllama(answer: OllamaAnswer, model: ModelId): Anthropic.Message {
  const content: Record<string, unknown>[] = [];
  if (answer.message?.content) content.push({ type: "text", text: answer.message.content, citations: null });
  (answer.message?.tool_calls ?? []).forEach((call, i) => {
    let input = call.function?.arguments ?? {};
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        input = {};
      }
    }
    content.push({ type: "tool_use", id: `call_${Date.now()}_${i}`, name: call.function?.name, input, caller: { type: "direct" } });
  });
  const called = content.some((block) => block.type === "tool_use");
  return {
    id: `ollama_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: answer.done_reason === "length" ? "max_tokens" : called ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: answer.prompt_eval_count ?? 0,
      output_tokens: answer.eval_count ?? 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

/** About how many tokens a request's text takes: four characters a token, as English and code roughly run. Images
 *  are counted by the model in its own way, so they're left out. */
export const roughTokens = (body: Item) =>
  Math.ceil(JSON.stringify(body, (key, value) => (key === "images" ? undefined : value)).length / 4);

/** The least room for an answer worth asking for: a tool call with a file in it. */
const LEAST_ANSWER = 2048;

/**
 * Models on the person's own computer, through Ollama's own chat API, which is the one that lets a call say how
 * much context the model gets.
 */
export class OllamaProvider implements ModelProvider {
  private contexts = new Map<string, number>();

  constructor(
    private baseURL = OLLAMA_DEFAULT,
    private fetcher: typeof fetch = fetch,
  ) {}

  async send(request: ModelRequest): Promise<Anthropic.Message> {
    const name = apiName(request.model);
    const label = MODELS[request.model]?.label ?? name;
    const context = await this.contextFor(name);
    // Ollama would drop the start of a conversation that doesn't fit and answer anyway, so say so instead. The
    // answer gets what room the prompt leaves, up to what the step asked for.
    const room = context - roughTokens(toOllamaRequest(request, context));
    const body = toOllamaRequest(request, context, Math.min(request.maxTokens, room));
    if (room < LEAST_ANSWER)
      throw new Error(
        context < OLLAMA_CONTEXT
          ? `${label} can hold about ${thousands(context)} tokens, and this step needs more. Pick a model with a longer context in Stack.`
          : `This step outgrew the ${thousands(context)} tokens Shoji gives a model on this computer. Move it to a larger model or another provider in Stack.`,
      );
    let answer: Response;
    try {
      answer = await this.fetcher(`${this.baseURL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Shoji couldn't reach Ollama on this computer. Open Ollama, then try again.");
    }
    const said = (await answer.json().catch(() => ({}))) as OllamaAnswer & { error?: string };
    if (!answer.ok || said.error) {
      const error = said.error?.trim() ?? answer.statusText;
      if (answer.status === 404 || /not found/i.test(error))
        throw new Error(`Ollama doesn't have ${name}. Pull it with "ollama pull ${name}", or pick another model in Stack.`);
      if (/does not support tools/i.test(error))
        throw new Error(`${label} can't use tools, which every step needs. Pick another model in Stack.`);
      throw new Error(`Ollama turned the request down: ${error}`);
    }
    return fromOllama(said, request.model);
  }

  /** How much context a step on this model gets, asked of Ollama once per model. */
  private async contextFor(name: string): Promise<number> {
    const known = this.contexts.get(name);
    if (known !== undefined) return known;
    let made: number | null = null;
    try {
      const shown = await this.fetcher(`${this.baseURL}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (shown.ok) made = contextOf((await shown.json()) as { model_info?: Record<string, unknown> });
    } catch {
      // The call itself will say whether Ollama is there.
    }
    const context = stepContext(made);
    this.contexts.set(name, context);
    return context;
  }
}

/** A token count as people say it: 8K, 64K. */
export const thousands = (tokens: number) => `${Math.round(tokens / 1024)}K`;
