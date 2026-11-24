// @vitest-environment node
import { describe, expect, it } from "vitest";
import { connect } from "../src/connect";
import { foundModelsIn, localModel } from "../src/found";
import { LocalProvider, localServers } from "../src/local";

const request = {
  model: "local/qwen/qwen3-coder-30b",
  effort: "medium" as const,
  system: "You are the builder.",
  maxTokens: 900,
  messages: [{ role: "user" as const, content: "Change the greeting." }],
};

/** Two servers on this computer, each listing its models, answering chat calls as the script says. */
function servers(chat: { status: number; body: unknown }) {
  const sent: string[] = [];
  const fetcher = (async (url: string) => {
    sent.push(url);
    if (url === "http://127.0.0.1:1234/v1/models") return Response.json({ data: [{ id: "gemma-3-12b" }] });
    if (url === "http://127.0.0.1:8080/v1/models") return Response.json({ data: [{ id: "qwen/qwen3-coder-30b" }] });
    if (url === "http://127.0.0.1:8080/v1/chat/completions") return Response.json(chat.body, { status: chat.status });
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

describe("a local server", () => {
  it("finds which server has the model once, and calls it there", async () => {
    const reply = { choices: [{ finish_reason: "stop", message: { content: "Done." } }], usage: { prompt_tokens: 50, completion_tokens: 3 } };
    const { sent, fetcher } = servers({ status: 200, body: reply });
    const provider = new LocalProvider(localServers(undefined), fetcher);
    expect((await provider.send(request)).content).toMatchObject([{ type: "text", text: "Done." }]);
    await provider.send(request);
    expect(sent).toEqual([
      "http://127.0.0.1:1234/v1/models",
      "http://127.0.0.1:8080/v1/models",
      "http://127.0.0.1:8080/v1/chat/completions",
      "http://127.0.0.1:8080/v1/chat/completions",
    ]);
  });

  it("says to load the model with more context when a step outgrows it", async () => {
    const tooLong = { error: { message: "the request exceeds the available context size, try increasing it" } };
    const provider = new LocalProvider(localServers(undefined), servers({ status: 400, body: tooLong }).fetcher);
    await expect(provider.send(request)).rejects.toThrow(
      "qwen3-coder-30b's context on llama.cpp is too short for this step. Load it with a context of at least 32K in llama.cpp, then try again.",
    );
  });

  it("says when no server has the model", async () => {
    const provider = new LocalProvider(localServers(undefined), servers({ status: 200, body: {} }).fetcher);
    await expect(provider.send({ ...request, model: "local/mistral-small" })).rejects.toThrow(
      "Shoji couldn't find mistral-small on LM Studio or llama.cpp. Start the server with the model loaded, then try again.",
    );
  });

  it("looks where SHOJI_LOCAL_URL says, and lists models by the last part of their names", () => {
    expect(localServers("http://127.0.0.1:5001/v1/")).toEqual([{ name: "your local server", url: "http://127.0.0.1:5001" }]);
    expect(localModel("qwen/qwen3-coder-30b")).toEqual([
      "local/qwen/qwen3-coder-30b",
      { label: "qwen3-coder-30b", input: 0, output: 0, cacheRead: 0, billing: "local" },
    ]);
    expect(Object.keys(foundModelsIn({ build: { model: "local/qwen/qwen3-coder-30b" } }))).toEqual(["local/qwen/qwen3-coder-30b"]);
    expect(connect({}).reaches("local/qwen/qwen3-coder-30b")).toBe(true);
  });
});
