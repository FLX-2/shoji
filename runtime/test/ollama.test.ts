// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foundModelsIn, ollamaModel } from "../src/found";
import { contextOf, OLLAMA_CONTEXT, OllamaProvider, ollamaUrl, toOllamaMessages } from "../src/ollama";

describe("Ollama's address", () => {
  it("reads OLLAMA_HOST as Ollama does, and falls back to its usual place", () => {
    expect(ollamaUrl(undefined)).toBe("http://127.0.0.1:11434");
    expect(ollamaUrl("")).toBe("http://127.0.0.1:11434");
    expect(ollamaUrl("0.0.0.0:11434")).toBe("http://127.0.0.1:11434");
    expect(ollamaUrl("0.0.0.0")).toBe("http://127.0.0.1:11434");
    expect(ollamaUrl("192.168.1.20:8080")).toBe("http://192.168.1.20:8080");
    expect(ollamaUrl("https://ollama.example.com")).toBe("https://ollama.example.com");
  });
});

describe("Ollama's models", () => {
  it("are listed by their own names, free and on this computer", () => {
    expect(ollamaModel("gemma4:latest")).toEqual([
      "ollama/gemma4:latest",
      { label: "gemma4", input: 0, output: 0, cacheRead: 0, billing: "local" },
    ]);
    expect(ollamaModel(`${"x".repeat(60)}:7b`)[1].label).toHaveLength(40);
  });

  it("are read from a stack, so a run knows them however the app found them", () => {
    const stack = {
      scout: { model: "ollama/gemma4:31b", effort: "low" },
      plan: { model: "claude-opus-5-5", effort: "medium" },
      build: { model: "ollama/qwen3-coder", effort: "low" },
      review: { model: "ollama/", effort: "low" },
    };
    expect(Object.keys(foundModelsIn(stack))).toEqual(["ollama/gemma4:31b", "ollama/qwen3-coder"]);
    expect(foundModelsIn(null)).toEqual({});
  });
});

describe("OllamaProvider", () => {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: {} };
  let shown: unknown = { model_info: { "gemma3.context_length": 131072 } };
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body: JSON.parse(text || "{}") });
        const { status, body } = req.url === "/api/show" ? { status: 200, body: shown } : answer;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  const request = { model: "ollama/gemma4:31b", effort: "high" as const, system: "You are the scout.", maxTokens: 900 };
  const toolCall = {
    message: { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "src/hello.js" } } }] },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 812,
    eval_count: 41,
  };

  it("sends Ollama's own chat call with room for a coding step, and reads the answer as Anthropic's", async () => {
    answer = { status: 200, body: toolCall };
    seen.length = 0;
    const reply = await new OllamaProvider(url).send({
      ...request,
      messages: [{ role: "user", content: "Find the greeting." }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: {} } }],
    });
    expect(reply.stop_reason).toBe("tool_use");
    expect(reply.content[0]).toMatchObject({ type: "tool_use", name: "read_file", input: { path: "src/hello.js" } });
    expect(reply.usage.input_tokens).toBe(812);
    expect(seen.map((s) => s.path)).toEqual(["/api/show", "/api/chat"]);
    const sent = seen.at(-1)!.body;
    expect(sent.model).toBe("gemma4:31b");
    expect(sent.stream).toBe(false);
    // Ollama's default can be 4K, which a coding step outgrows in a few turns.
    expect(sent.options).toEqual({ num_ctx: OLLAMA_CONTEXT, num_predict: 900 });
    expect(sent.messages).toEqual([
      { role: "system", content: "You are the scout." },
      { role: "user", content: "Find the greeting." },
    ]);
    expect(sent.tools).toEqual([
      { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("asks a model's context once, and gives a smaller model only what it was made for", async () => {
    shown = { model_info: { "llama.context_length": 8192 } };
    answer = { status: 200, body: { message: { content: "Hi." }, done_reason: "stop" } };
    seen.length = 0;
    const provider = new OllamaProvider(url);
    const send = () => provider.send({ ...request, model: "ollama/small:1b", messages: [{ role: "user", content: "Hi" }] });
    await send();
    await send();
    expect(seen.map((s) => s.path)).toEqual(["/api/show", "/api/chat", "/api/chat"]);
    expect((seen[1].body.options as { num_ctx: number }).num_ctx).toBe(8192);
    shown = { model_info: { "gemma3.context_length": 131072 } };
  });

  it("says a step doesn't fit rather than letting Ollama drop the start of it", async () => {
    shown = { model_info: { "llama.context_length": 8192 } };
    const long = { ...request, model: "ollama/tiny:1b", messages: [{ role: "user" as const, content: "x".repeat(40_000) }] };
    await expect(new OllamaProvider(url).send(long)).rejects.toThrow(
      "tiny:1b can hold about 8K tokens, and this step needs more. Pick a model with a longer context in Stack.",
    );
    shown = { model_info: { "gemma3.context_length": 131072 } };
    const huge = { ...request, messages: [{ role: "user" as const, content: "x".repeat(300_000) }] };
    await expect(new OllamaProvider(url).send(huge)).rejects.toThrow("This step outgrew the 64K tokens");
  });

  it("sends tool answers back by the tool's name, with any pictures", () => {
    const messages = toOllamaMessages("You are the builder.", [
      { role: "user", content: "Fix it." },
      { role: "assistant", content: [{ type: "tool_use", id: "call_9", name: "look_at_page", input: { path: "/" } }] },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_9",
            content: [
              { type: "text", text: "The page at 1280px." },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
            ],
          },
        ],
      },
    ]);
    expect(messages.slice(2)).toEqual([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "look_at_page", arguments: { path: "/" } } }] },
      { role: "tool", content: "The page at 1280px.", tool_name: "look_at_page" },
      { role: "user", content: "", images: ["iVBOR"] },
    ]);
    expect(contextOf({ model_info: { "qwen3.context_length": 40960 } })).toBe(40960);
    expect(contextOf({})).toBeNull();
  });

  it("says what to do when a model isn't pulled, can't use tools, or Ollama isn't running", async () => {
    const send = (to = url) => new OllamaProvider(to).send({ ...request, messages: [{ role: "user", content: "Hi" }] });
    answer = { status: 404, body: { error: "model 'gemma4:31b' not found" } };
    await expect(send()).rejects.toThrow('Ollama doesn\'t have gemma4:31b. Pull it with "ollama pull gemma4:31b"');
    answer = { status: 400, body: { error: "registry.ollama.ai/library/gemma4:31b does not support tools" } };
    await expect(send()).rejects.toThrow("can't use tools, which every step needs");
    await expect(send("http://127.0.0.1:9")).rejects.toThrow("Shoji couldn't reach Ollama on this computer.");
  });
});
