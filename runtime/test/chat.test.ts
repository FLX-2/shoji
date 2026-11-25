// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { ChatProvider, GEMINI_API, toMessage, toMessages, toRequest } from "../src/chat";
import { connect } from "../src/connect";
import { geminiClosed, geminiFreeFamily, geminiModel } from "../src/found";
import { applyFound, costOf } from "../src/models";
import { KeyRejectedError, nextPacificMidnight, RouteLimitError } from "../src/provider";

const FLASH = "gemini/gemini-3.5-flash";

const request = {
  model: FLASH,
  effort: "xhigh" as const,
  system: "You are the builder.",
  maxTokens: 16000,
  messages: [
    { role: "user" as const, content: "Change the greeting." },
    {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "…", signature: "s" },
        { type: "text" as const, text: "Reading it first." },
        {
          type: "tool_use" as const,
          id: "call_1",
          name: "read_file",
          input: { path: "src/hello.js" },
          extra_content: { google: { thought_signature: "sig" } },
        },
      ],
    },
    {
      role: "user" as const,
      content: [
        { type: "tool_result" as const, tool_use_id: "call_1", content: "export default 'hello';" },
        { type: "text" as const, text: "Keep it short." },
      ],
    },
  ],
  tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object" as const, properties: {} } }],
};

/** A stand-in for Google's endpoint that answers each call with the next of `answers`, and keeps what was sent. */
function service(...answers: { status?: number; body: unknown }[]) {
  const sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const answer = answers.shift()!;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

const reply = (content: string) => ({
  choices: [{ finish_reason: "stop", message: { content } }],
  usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 200 } },
});

describe("Chat Completions, as Gemini takes it", () => {
  afterEach(() => applyFound("gemini", {}));

  it("sends the conversation with each tool call's signature, and tool answers before the person's words", () => {
    const messages = toMessages(request.system, request.messages);
    expect(messages).toEqual([
      { role: "system", content: "You are the builder." },
      { role: "user", content: [{ type: "text", text: "Change the greeting." }] },
      {
        role: "assistant",
        content: "Reading it first.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"src/hello.js"}' },
            extra_content: { google: { thought_signature: "sig" } },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "export default 'hello';" },
      { role: "user", content: [{ type: "text", text: "Keep it short." }] },
    ]);
    const body = toRequest(request);
    expect(body.model).toBe("gemini-3.5-flash");
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBe(16000);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("reads an answer's tool calls, keeping their signatures, and its usage with the cached part apart", () => {
    const message = toMessage(
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                { id: "c2", function: { name: "edit_file", arguments: '{"path":"a"}' }, extra_content: { google: { thought_signature: "t" } } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } },
      },
      FLASH,
    );
    expect(message.stop_reason).toBe("tool_use");
    expect(message.content).toEqual([
      { type: "tool_use", id: "c2", name: "edit_file", input: { path: "a" }, caller: { type: "direct" }, extra_content: { google: { thought_signature: "t" } } },
    ]);
    expect(message.usage).toMatchObject({ input_tokens: 600, output_tokens: 50, cache_read_input_tokens: 400 });
  });

  it("reads an answer that ran out of room as cut off, even when it holds a tool call", () => {
    const message = toMessage(
      {
        choices: [
          {
            finish_reason: "length",
            message: { content: null, tool_calls: [{ id: "c3", function: { name: "write_file", arguments: '{"path":"a","content":"exp' } }] },
          },
        ],
      },
      FLASH,
    );
    expect(message.stop_reason).toBe("max_tokens");
  });

  it("calls Gemini on the key, and leaves out a field the model turns down once", async () => {
    const { sent, fetch } = service(
      { status: 400, body: [{ error: { message: "Invalid value for reasoning_effort" } }] },
      { body: reply("Done.") },
    );
    const provider = new ChatProvider({ service: "Gemini", baseURL: GEMINI_API, key: "AIza-test", fetch, backoff: 0 });
    const message = await provider.send(request);
    expect(message.content).toEqual([{ type: "text", text: "Done.", citations: null }]);
    expect(sent[0].url).toBe(`${GEMINI_API}/chat/completions`);
    expect(sent[0].headers.authorization).toBe("Bearer AIza-test");
    expect(sent[0].body.reasoning_effort).toBe("high");
    expect("reasoning_effort" in sent[1].body).toBe(false);
  });

  it("says plainly when the key is turned down, and when the free tier's limit is reached", async () => {
    const turnedDown = new ChatProvider({
      service: "Gemini",
      baseURL: GEMINI_API,
      key: "bad",
      fetch: service({ status: 400, body: [{ error: { message: "API key not valid. Please pass a valid API key." } }] }).fetch,
      backoff: 0,
    });
    await expect(turnedDown.send(request)).rejects.toBeInstanceOf(KeyRejectedError);

    applyFound("gemini", Object.fromEntries([geminiModel("gemini-3.5-flash", "Gemini 3.5 Flash", true)!]));
    const limited = new ChatProvider({
      service: "Gemini",
      baseURL: GEMINI_API,
      key: "AIza-test",
      fetch: service({ status: 429, body: [{ error: { message: "Resource has been exhausted" } }] }).fetch,
      backoff: 0,
    });
    const error = await limited.send(request).catch((e) => e);
    expect(error).toBeInstanceOf(RouteLimitError);
    expect(error).toMatchObject({ message: "Gemini's free tier has reached its limit for now.", provider: "gemini" });
    expect(error.resetsAt).toBeUndefined();
  });

  it("says plainly when Google no longer serves a model to new keys, or its free tier leaves a model out", async () => {
    applyFound("gemini", Object.fromEntries([geminiModel("gemini-3.5-flash", "Gemini 3.5 Flash", true)!]));
    const closed = new ChatProvider({
      service: "Gemini",
      baseURL: GEMINI_API,
      key: "AIza-test",
      fetch: service({
        status: 404,
        body: [{ error: { message: "This model models/gemini-3.5-flash is no longer available to new users. Please update your code." } }],
      }).fetch,
      backoff: 0,
    });
    await expect(closed.send(request)).rejects.toThrow("Gemini no longer offers Gemini 3.5 Flash to new keys. Pick another model in Stack.");

    const nothing = {
      status: 429,
      body: [
        {
          error: {
            message:
              "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-4-argon, description: Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 41s.",
          },
        },
      ],
    };
    const left = service(nothing, { body: reply("Done.") });
    const leftOut = new ChatProvider({ service: "Gemini", baseURL: GEMINI_API, key: "AIza-test", fetch: left.fetch, backoff: 0 });
    const error = await leftOut.send(request).catch((e) => e);
    expect(error).not.toBeInstanceOf(RouteLimitError);
    expect(left.sent).toHaveLength(1);
    expect(error.message).toBe("Gemini's free tier doesn't include Gemini 3.5 Flash. Pick another model in Stack.");
  });

  it("waits out a free tier's per-minute limit once, and says when a daily one lifts", async () => {
    applyFound("gemini", Object.fromEntries([geminiModel("gemini-3.5-flash", "Gemini 3.5 Flash", true)!]));
    const minute = { status: 429, body: [{ error: { message: "Quota exceeded for metric: requests per minute. Please retry in 12.5s." } }] };
    const waited = new ChatProvider({
      service: "Gemini",
      baseURL: GEMINI_API,
      key: "AIza-test",
      fetch: service(minute, { body: reply("Done.") }).fetch,
      backoff: 0,
    });
    expect((await waited.send(request)).content).toMatchObject([{ type: "text", text: "Done." }]);

    const day = { status: 429, body: [{ error: { message: "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 30s." } }] };
    const daily = new ChatProvider({ service: "Gemini", baseURL: GEMINI_API, key: "AIza-test", fetch: service(day).fetch, backoff: 0 });
    const error = await daily.send(request).catch((e) => e);
    expect(error).toMatchObject({ message: "Gemini's free tier has reached its limit for today.", provider: "gemini" });
    expect(error.resetsAt).toBeGreaterThan(Date.now());
    expect(error.resetsAt - Date.now()).toBeLessThanOrEqual(86_400_000);
  });

  it("finds the next midnight in California", () => {
    // 3 PM in Los Angeles on 2026-11-24 (UTC-8) is 23:00 UTC; midnight there is 08:00 UTC the next day.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 10, 24, 23, 0, 0))).toISOString()).toBe("2026-11-25T08:00:00.000Z");
    // Just after midnight there, the next one is a whole day off.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 10, 25, 8, 0, 1))).toISOString()).toBe("2026-11-26T08:00:00.000Z");
  });

  it("reaches Gemini's models when a run is handed the key", () => {
    expect(connect({}).reaches(FLASH)).toBe(false);
    expect(connect({ SHOJI_GEMINI_KEY: "AIza-test" }).reaches(FLASH)).toBe(true);
  });
});

describe("Gemini's models", () => {
  afterEach(() => applyFound("gemini", {}));

  it("prices a listed model by the name it starts with, and charges nothing on the free tier", () => {
    const [id, paid] = geminiModel("gemini-2.5-flash-lite-preview-09-2025", "Flash-Lite Preview", false)!;
    expect(id).toBe("gemini/gemini-2.5-flash-lite-preview-09-2025");
    expect(paid).toEqual({ label: "Flash-Lite Preview", input: 0.1, output: 0.4, cacheRead: 0.01 });

    const [, free] = geminiModel("gemini-3.5-flash", "Gemini 3.5 Flash", true)!;
    expect(free.billing).toBe("free");
    applyFound("gemini", { [FLASH]: free });
    expect(costOf(FLASH, { input_tokens: 1e6, output_tokens: 1e6 } as never)).toBe(0);
  });

  it("leaves out a model the free tier doesn't offer, and on a paid key one Shoji can't price", () => {
    expect(geminiModel("gemini-3.1-pro-preview", "Gemini 3.1 Pro", true)).toBeNull();
    expect(geminiModel("gemini-3.1-pro-preview", "Gemini 3.1 Pro", false)).not.toBeNull();
    expect(geminiModel("gemini-4-flash", "Gemini 4 Flash", false)).toBeNull();
    // Google lists models whose free allowance is nothing, so an unknown one isn't offered free.
    expect(geminiModel("gemini-4-flash", "Gemini 4 Flash", true)).toBeNull();
    expect(geminiModel("gemini-pro-latest", "Gemini Pro Latest", true)).toBeNull();
  });

  it("offers the free models a new key can run, at nothing when Shoji has no price for them", () => {
    expect(geminiModel("gemini-3.6-flash", "Gemini 3.6 Flash", true)![1]).toMatchObject({ output: 0, billing: "free" });
    expect(geminiModel("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", true)![1]).toMatchObject({ billing: "free" });
    expect(geminiModel("gemini-3-flash-preview", "Gemini 3 Flash Preview", true)![1]).toMatchObject({ output: 3, billing: "free" });
    expect(geminiFreeFamily("gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(geminiFreeFamily("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(geminiFreeFamily("gemini-3.1-flash-lite-preview")).toBe("gemini-3.1-flash-lite");
  });

  it("knows the 2.5 models Google no longer serves to new keys, and still offers them to keys that have them", () => {
    expect(geminiClosed("gemini-2.5-pro")).toBe(true);
    expect(geminiClosed("gemini-2.5-flash-lite")).toBe(true);
    expect(geminiClosed("gemini-3.5-flash")).toBe(false);
    expect(geminiModel("gemini-2.5-pro", "Gemini 2.5 Pro", true)).not.toBeNull();
  });
});
