// @vitest-environment node
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { connect, planToken, unreachable } from "../src/connect";
import { Inbox } from "../src/inbox";
import { OpenAIProvider, PlanLimitError, readStream, toInput, toMessage, toRequest, type ResponsesResult } from "../src/openai";
import { KeyRejectedError } from "../src/provider";

const request = {
  model: "chatgpt/gpt-6",
  effort: "max" as const,
  system: "You are the builder.",
  maxTokens: 16000,
  messages: [
    { role: "user" as const, content: "Change the greeting." },
    {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "…", signature: "s" },
        { type: "text" as const, text: "Reading it first." },
        { type: "tool_use" as const, id: "call_1", name: "read_file", input: { path: "src/hello.js" } },
      ],
    },
    {
      role: "user" as const,
      content: [{ type: "tool_result" as const, tool_use_id: "call_1", content: "export default 'hello';" }],
    },
  ],
  tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object" as const, properties: {} } }],
};

/** A streamed answer, as OpenAI sends one: server-sent events, cut wherever the network cuts them. */
function stream(...events: object[]) {
  const text = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
}

const completed = (output: ResponsesResult["output"], usage = { input_tokens: 1200, output_tokens: 80, input_tokens_details: { cached_tokens: 1000 } }) => ({
  type: "response.completed",
  response: { status: "completed", output, usage },
});

const toolCall = { type: "function_call", call_id: "call_2", name: "write_file", namespace: "shoji", arguments: '{"path":"src/hello.js","content":"hi"}' };

describe("the Responses translation", () => {
  it("sends the conversation as input items, tools in one namespace, and no output limit on a plan", () => {
    const body = toRequest(request, true);
    expect(body).toMatchObject({ model: "gpt-6", instructions: "You are the builder.", store: false, stream: true });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(toRequest(request, false).max_output_tokens).toBe(16000);
    expect((body.tools as { type: string; name: string; tools: unknown[] }[])[0]).toMatchObject({
      type: "namespace",
      name: "shoji",
      tools: [{ type: "function", name: "read_file", description: "Read a file" }],
    });
    expect(toInput(request.messages)).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Change the greeting." }] },
      { role: "assistant", content: [{ type: "output_text", text: "Reading it first." }] },
      { type: "function_call", call_id: "call_1", name: "read_file", namespace: "shoji", arguments: '{"path":"src/hello.js"}' },
      { type: "function_call_output", call_id: "call_1", output: "export default 'hello';" },
    ]);
  });

  it("sends images as data, in a tool's answer too", () => {
    const image = { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "AAA" } };
    const items = toInput([
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: [{ type: "text", text: "The page" }, image] }] },
    ]);
    expect(items[0]).toEqual({
      type: "function_call_output",
      call_id: "c",
      output: [
        { type: "input_text", text: "The page" },
        { type: "input_image", image_url: "data:image/png;base64,AAA" },
      ],
    });
  });

  it("reads an answer back as the message the roles read, with cached input apart", () => {
    const message = toMessage(
      completed([{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "Writing it." }] }, toolCall])
        .response,
      "chatgpt/gpt-6",
    );
    expect(message.stop_reason).toBe("tool_use");
    expect(message.content).toEqual([
      { type: "text", text: "Writing it.", citations: null },
      { type: "tool_use", id: "call_2", name: "write_file", input: { path: "src/hello.js", content: "hi" }, caller: { type: "direct" } },
    ]);
    expect(message.usage).toMatchObject({ input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 80 });
  });

  it("counts only a finished answer, and throws a failure that arrives partway", async () => {
    await expect(readStream(stream({ type: "response.output_text.delta", delta: "Hi" }, completed([])))).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      readStream(
        stream(
          { type: "response.output_text.delta", delta: "Hi" },
          { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Limit" } } },
        ),
      ),
    ).rejects.toMatchObject({ code: "subscription_sharing_usage_limit_exceeded" });
    await expect(readStream(stream({ type: "response.output_text.delta", delta: "Hi" }))).rejects.toMatchObject({
      code: "interrupted",
    });
  });
});

/** A stand-in for OpenAI that answers each call from a list and keeps what was sent. */
function openai(...answers: ((body: Record<string, unknown>) => Response)[]) {
  const sent: { auth: string; body: Record<string, unknown> }[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ auth: (init.headers as Record<string, string>).authorization, body });
    return answers[sent.length - 1](body);
  }) as unknown as typeof fetch;
  return { fake, sent };
}

const ok = (...events: object[]) => () => new Response(stream(...events), { status: 200 });
const failed = (status: number, code: string, param?: string) => () =>
  new Response(JSON.stringify({ error: { code, message: code, param } }), { status });

describe("OpenAIProvider", () => {
  it("sends a key's tools flat, since only the plan's route groups them", () => {
    const body = toRequest(request, false);
    expect((body.tools as { type: string; name: string }[])[0]).toMatchObject({ type: "function", name: "read_file" });
    const items = toInput([{ role: "assistant", content: [{ type: "tool_use", id: "c", name: "read_file", input: {} }] }], false);
    expect(items[0]).not.toHaveProperty("namespace");
  });

  it("reaches OpenRouter by its own address and names it, whose error codes are numbers", async () => {
    const { fake } = openai(() => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 }));
    const provider = new OpenAIProvider({
      plan: false,
      service: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      credential: async () => "sk-or",
      fetch: fake,
    });
    await expect(provider.send({ ...request, model: "openrouter/vendor/large" })).rejects.toThrow(
      "Your OpenRouter account is out of credit. Add credit on OpenRouter's site, then try again.",
    );
  });

  it("answers a call on the plan", async () => {
    const { fake, sent } = openai(ok(completed([toolCall])));
    const provider = new OpenAIProvider({ plan: true, credential: async () => "tok", fetch: fake });
    const message = await provider.send(request);
    expect(message.stop_reason).toBe("tool_use");
    expect(sent[0].auth).toBe("Bearer tok");
  });

  it("stops a thread like its own limit when the plan runs out, even partway", async () => {
    const midway = { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } };
    const { fake } = openai(ok(midway));
    const provider = new OpenAIProvider({ plan: true, credential: async () => "tok", fetch: fake });
    await expect(provider.send(request)).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("renews a turned-down sign-in once, and then says to sign in again", async () => {
    const tokens: boolean[] = [];
    const credential = async (fresh?: boolean) => {
      tokens.push(!!fresh);
      return fresh ? "new" : "old";
    };
    const { fake, sent } = openai(failed(401, "subscription_sharing_invalid_user"), ok(completed([])));
    await new OpenAIProvider({ plan: true, credential, fetch: fake }).send(request);
    expect(sent.map((s) => s.auth)).toEqual(["Bearer old", "Bearer new"]);

    const twice = openai(failed(401, "x"), failed(401, "x"));
    await expect(new OpenAIProvider({ plan: true, credential, fetch: twice.fake }).send(request)).rejects.toThrow(
      new KeyRejectedError("ChatGPT signed Shoji out. Sign in with ChatGPT again in Settings."),
    );
  });

  it("leaves out a field the model doesn't take, once, rather than failing the step", async () => {
    const { fake, sent } = openai(failed(400, "subscription_sharing_unsupported_capability", "reasoning.effort"), ok(completed([])));
    await new OpenAIProvider({ plan: true, credential: async () => "tok", fetch: fake }).send(request);
    expect(sent[0].body).toHaveProperty("reasoning");
    expect(sent[1].body).not.toHaveProperty("reasoning");
  });

  it("waits out a plan that can't be checked for now, then says so plainly", async () => {
    const { fake, sent } = openai(
      failed(503, "subscription_sharing_usage_unavailable"),
      failed(503, "subscription_sharing_usage_unavailable"),
      failed(503, "subscription_sharing_usage_unavailable"),
    );
    await expect(new OpenAIProvider({ plan: true, credential: async () => "t", fetch: fake, backoff: 0 }).send(request)).rejects.toThrow(
      "ChatGPT couldn't take the request right now. Try again in a few minutes.",
    );
    expect(sent).toHaveLength(3);
  });

  it("names a plan that can't be shared, and an API key without credit", async () => {
    const plan = openai(failed(403, "subscription_sharing_user_not_eligible"));
    await expect(new OpenAIProvider({ plan: true, credential: async () => "t", fetch: plan.fake }).send(request)).rejects.toThrow(
      "Your ChatGPT plan can't be used in other apps. Plus and Pro plans can.",
    );
    const key = openai(failed(429, "insufficient_quota"));
    await expect(
      new OpenAIProvider({ plan: false, credential: async () => "k", fetch: key.fake }).send({ ...request, model: "openai/gpt-6" }),
    ).rejects.toThrow("Your OpenAI account is out of credit.");
  });
});

describe("a ChatGPT sign-in in a run", () => {
  it("renews its token near the end of its hour, and stops once the person has signed out", async () => {
    let now = 0;
    const renewals: string[] = [];
    let renewed: { token: string; expires: number } | null = { token: "b", expires: 7_200_000 };
    const token = planToken("a", 3_600_000, {
      now: () => now,
      renew: async () => {
        renewals.push("asked");
        return renewed;
      },
    });
    expect(await token()).toBe("a");
    now = 3_400_000;
    expect(await token()).toBe("b");
    expect(await token()).toBe("b");
    expect(renewals).toHaveLength(1);
    renewed = null;
    await expect(token(true)).rejects.toMatchObject({ code: "signed_out" });
  });

  it("connects the plan and an OpenAI key from the run's environment", () => {
    const providers = connect({ SHOJI_CHATGPT_TOKEN: "t", SHOJI_CHATGPT_EXPIRES: "1", SHOJI_OPENAI_KEY: "k" });
    expect(unreachable(providers, ["chatgpt/gpt-6", "openai/gpt-6"])).toBeNull();
    expect(unreachable(connect({}), ["chatgpt/gpt-6"])).toMatch(/connected to ChatGPT/);
  });

  it("hands each line of the run's input to whoever waits for its kind", async () => {
    const input = new PassThrough();
    const inbox = new Inbox(input);
    const token = inbox.next("token");
    input.write('{"allow":true}\n{"token":"fresh","expires":5}\n');
    expect(await token).toBe('{"token":"fresh","expires":5}');
    expect(await inbox.next("answer")).toBe('{"allow":true}');
    input.end();
    expect(await inbox.next("answer")).toBeNull();
  });
});
