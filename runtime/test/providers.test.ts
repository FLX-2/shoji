// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { connect, unreachable } from "../src/connect";
import {
  apiName,
  applyCatalog,
  applyFound,
  BUILT_IN,
  costOf,
  listedCostOf,
  MODELS,
  parseCatalog,
  providerOf,
  worstCaseOutput,
} from "../src/models";
import { NotConnectedError, Providers } from "../src/provider";
import { reply, ScriptedProvider } from "./helpers";

const usage = (input: number, output: number) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as never;

const request = (model: string) => ({ model, effort: "low" as const, system: "", messages: [], maxTokens: 100 });

describe("model ids", () => {
  it("are Anthropic's when bare, and any other provider's when it's named in front", () => {
    expect(providerOf("claude-haiku-5-5")).toBe("anthropic");
    expect(providerOf("ollama/qwen3-coder:30b")).toBe("ollama");
    expect(providerOf("openrouter/vendor/model")).toBe("openrouter");
    expect(apiName("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(apiName("openrouter/vendor/model")).toBe("vendor/model");
  });
});

describe("billing", () => {
  afterEach(() => {
    applyCatalog(null);
    applyFound("ollama", {});
    applyFound("stack", {});
  });

  const list = {
    version: 1,
    updated: "2026-12-01",
    models: {
      "ollama/gemma4": { label: "Gemma 4", input: 0, output: 0, cacheRead: 0, billing: "local" },
      "chatgpt/gpt-6": { label: "GPT-6", input: 2, output: 10, cacheRead: 0.2, billing: "plan" },
    },
  };

  it("charges nothing on the person's own computer or on their plan, but keeps the plan's listed price", () => {
    applyCatalog(parseCatalog(list));
    expect(costOf("ollama/gemma4", usage(1e6, 1e6))).toBe(0);
    expect(costOf("chatgpt/gpt-6", usage(1e6, 1e6))).toBe(0);
    expect(listedCostOf("chatgpt/gpt-6", usage(1e6, 1e6))).toBeCloseTo(12);
    // So the cap never stops a call that can't spend.
    expect(worstCaseOutput("chatgpt/gpt-6", 1e6)).toBe(0);
    expect(costOf("claude-haiku-5-5", usage(1e6, 1e6))).toBeCloseTo(0.6);
  });

  it("refuses a free price on a model that charges, a billing it doesn't know, and a provider it doesn't know", () => {
    const with_ = (id: string, entry: object) => () =>
      parseCatalog({ version: 1, updated: "2026-12-01", models: { [id]: entry } });
    expect(with_("openai/gpt-6", { label: "GPT-6", input: 0, output: 0, cacheRead: 0 })).toThrow(/prices/);
    expect(with_("openai/gpt-6", { label: "GPT-6", input: 1, output: 1, cacheRead: 0, billing: "gift" })).toThrow(
      /billing/,
    );
    expect(with_("acme/gpt-6", { label: "GPT-6", input: 1, output: 1, cacheRead: 0 })).toThrow(/names a model/);
  });

  it("adds the models found on a connection beside the list's, without changing a listed one", () => {
    applyCatalog(parseCatalog(list));
    applyFound("ollama", {
      "ollama/llama5": { label: "Llama 5", input: 0, output: 0, cacheRead: 0, billing: "local" },
      "claude-haiku-5-5": { label: "Cheap", input: 0, output: 0, cacheRead: 0, billing: "local" },
    });
    expect(MODELS["ollama/llama5"].label).toBe("Llama 5");
    expect(MODELS["claude-haiku-5-5"]).toEqual(BUILT_IN["claude-haiku-5-5"]);
    // A new list keeps what was found.
    applyCatalog(null);
    expect(MODELS["ollama/llama5"].label).toBe("Llama 5");
    // Each connection's models stand apart, so one looking again leaves the others.
    applyFound("stack", { "ollama/gemma4": { label: "gemma4", input: 0, output: 0, cacheRead: 0, billing: "local" } });
    applyFound("ollama", {});
    expect(Object.keys(MODELS)).toContain("ollama/gemma4");
    applyFound("stack", {});
    expect(MODELS).toEqual(BUILT_IN);
  });
});

describe("providers", () => {
  it("sends each call to the provider of the model it names", async () => {
    const anthropic = new ScriptedProvider(() => reply([{ text: "from anthropic" }]));
    const ollama = new ScriptedProvider(() => reply([{ text: "from ollama" }]));
    const providers = new Providers({ anthropic, ollama });
    await providers.send(request("ollama/gemma4"));
    await providers.send(request("claude-haiku-5-5"));
    expect(ollama.requests.map((r) => r.model)).toEqual(["ollama/gemma4"]);
    expect(anthropic.requests.map((r) => r.model)).toEqual(["claude-haiku-5-5"]);
  });

  it("says plainly which provider isn't connected", async () => {
    const providers = new Providers({});
    await expect(providers.send(request("openai/gpt-6"))).rejects.toThrow(NotConnectedError);
    await expect(providers.send(request("openai/gpt-6"))).rejects.toThrow(
      "Shoji isn't connected to OpenAI. Connect it in Settings, or pick another model in Stack.",
    );
  });

  it("connects Anthropic from the run's environment, and finds a model it can't reach before the run starts", () => {
    const none = connect({});
    expect(unreachable(none, ["claude-haiku-5-5"])).toMatch(/connected to Anthropic/);
    const keyed = connect({ SHOJI_API_KEY: "sk-test" });
    expect(unreachable(keyed, ["claude-haiku-5-5", "claude-opus-5-5"])).toBeNull();
    expect(unreachable(none, ["openai/gpt-6"])).toMatch(/connected to OpenAI/);
    // Ollama needs no key, so it's always there to try.
    expect(unreachable(none, ["ollama/gemma4"])).toBeNull();
    expect(unreachable(connect({ ANTHROPIC_API_KEY: " sk-test " }), ["claude-haiku-5-5"])).toBeNull();
  });
});
