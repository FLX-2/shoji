import { describe, expect, it } from "vitest";
import { MAX_TOKENS } from "../src/agent";
import { BudgetExceeded, Meter, roughTokens } from "../src/meter";
import { applyFound, type ModelId } from "../src/models";
import type { ModelRequest } from "../src/provider";
import { reply, ScriptedProvider } from "./helpers";

const OPUS: ModelId = "claude-opus-5-5";
const SONNET: ModelId = "claude-sonnet-5-5";

const request = (model: ModelId, prompt: string): ModelRequest => ({
  model,
  effort: "medium",
  system: "You are the planner.",
  messages: [{ role: "user", content: prompt }],
  maxTokens: MAX_TOKENS,
});

describe("the meter's cap", () => {
  it("counts a long prompt before the call, so one call can't pass the cap by what its prompt costs", async () => {
    // About 115,000 tokens of prompt: $0.46 on Opus before a word of the answer, which leaves no room for one.
    // The answer's worst case alone, $0.32, would have let the call go and end at $0.78.
    const long = "word ".repeat(80_000);
    const provider = new ScriptedProvider(() => reply([{ text: "A plan." }], { input_tokens: 115_000 }));
    const meter = new Meter(provider, () => {}, 0.5);

    await expect(meter.send("plan", "plan", request(OPUS, long))).rejects.toBeInstanceOf(BudgetExceeded);
    expect(provider.requests).toHaveLength(0);
    expect(meter.spent).toBe(0);
  });

  it("leaves a short prompt its whole answer", async () => {
    const provider = new ScriptedProvider(() => reply([{ text: "A plan." }]));
    const meter = new Meter(provider, () => {}, 0.5);

    await meter.send("plan", "plan", request(OPUS, "Make the greeting say hello to Shoji."));
    expect(provider.requests[0].maxTokens).toBe(MAX_TOKENS);
  });

  it("shortens the answer by what the prompt will cost, while that still leaves room to work", async () => {
    // About 20,000 tokens, $0.08 on Opus. The answer's worst case is $0.32, so at $0.35 it gets less.
    const provider = new ScriptedProvider(() => reply([{ text: "A plan." }], { input_tokens: 20_000 }));
    const meter = new Meter(provider, () => {}, 0.35);

    await meter.send("plan", "plan", request(OPUS, "word ".repeat(14_000)));
    const room = provider.requests[0].maxTokens;
    expect(room).toBeLessThan(MAX_TOKENS);
    // What's left after the prompt, at Opus's $20 a million for output.
    expect(room).toBeCloseTo((0.35 - 0.08) / 20e-6, -3);
    expect(meter.spent).toBeLessThanOrEqual(0.35);
  });

  it("prices a step's next prompt as its last call was charged: from the cache when that call used it", async () => {
    // Sonnet: $2 in, $0.10 read from the cache, $10 out, so a whole answer's worst case is $0.16.
    const run = async (usage: Parameters<typeof reply>[1]) => {
      const provider = new ScriptedProvider(() => reply([{ text: "Done." }], usage));
      const meter = new Meter(provider, () => {}, 0.3);
      await meter.send("build", "build", request(SONNET, "Build it."));
      await meter.send("build", "build", request(SONNET, "Build it."));
      return provider.requests[1].maxTokens;
    };

    // The first call wrote 50,000 tokens to the cache for $0.125. Read back they cost half a cent, so the
    // second call keeps its whole answer.
    expect(await run({ input_tokens: 0, cache_creation_input_tokens: 50_000 })).toBe(MAX_TOKENS);
    // With no cache, the same prompt costs $0.10 again, and the answer gets what's left.
    const room = await run({ input_tokens: 50_000 });
    expect(room).toBeLessThan(MAX_TOKENS);
    expect(room).toBeGreaterThan(9000);
  });

  it("counts nothing for a model that charges nothing", async () => {
    applyFound("ollama", { "ollama/llama4:8b": { label: "llama4:8b", input: 0, output: 0, cacheRead: 0, billing: "local" } });
    const provider = new ScriptedProvider(() => reply([{ text: "A plan." }]));
    const meter = new Meter(provider, () => {}, 0.01);

    await meter.send("plan", "plan", request("ollama/llama4:8b", "word ".repeat(70_000)));
    expect(provider.requests[0].maxTokens).toBe(MAX_TOKENS);
  });

  it("measures a prompt by its text, and a picture as a fixed amount whatever its size", () => {
    expect(roughTokens("x".repeat(3500))).toBe(1000);
    expect(roughTokens([{ type: "text", text: "x".repeat(350) }])).toBeGreaterThanOrEqual(100);
    expect(roughTokens([{ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(1e6) } }])).toBe(1500);
  });
});
