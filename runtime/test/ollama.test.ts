// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foundModelsIn, ollamaModel } from "../src/found";
import { OllamaProvider, ollamaUrl } from "../src/ollama";

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
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body: JSON.parse(text || "{}") });
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  const request = { model: "ollama/gemma4:31b", effort: "high" as const, system: "You are the scout.", maxTokens: 900 };

  it("sends the model's own name, with no caching or effort, and reads the answer as Anthropic's", async () => {
    // As Ollama's /v1/messages answered a tool call.
    answer = {
      status: 200,
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "gemma4:31b",
        content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "src/hello.js" } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 812, output_tokens: 41 },
      },
    };
    const reply = await new OllamaProvider(url).send({
      ...request,
      messages: [{ role: "user", content: "Find the greeting." }],
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: {} } }],
    });
    expect(reply.stop_reason).toBe("tool_use");
    expect(reply.usage.input_tokens).toBe(812);
    const sent = seen.at(-1)!;
    expect(sent.path).toBe("/v1/messages");
    expect(sent.body.model).toBe("gemma4:31b");
    expect(sent.body.max_tokens).toBe(900);
    expect(sent.body).not.toHaveProperty("cache_control");
    expect(sent.body).not.toHaveProperty("output_config");
  });

  it("says what to do when a model isn't pulled, can't use tools, or Ollama isn't running", async () => {
    const send = (to = url) => new OllamaProvider(to).send({ ...request, messages: [{ role: "user", content: "Hi" }] });
    answer = { status: 404, body: { type: "error", error: { type: "not_found_error", message: "model 'gemma4:31b' not found" } } };
    await expect(send()).rejects.toThrow('Ollama doesn\'t have gemma4:31b. Pull it with "ollama pull gemma4:31b"');
    answer = {
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: "gemma4:31b does not support tools" } },
    };
    await expect(send()).rejects.toThrow("can't use tools, which every step needs");
    await expect(send("http://127.0.0.1:9")).rejects.toThrow("Shoji couldn't reach Ollama on this computer.");
  });
});
