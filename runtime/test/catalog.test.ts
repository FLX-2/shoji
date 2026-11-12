// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCatalog, BUILT_IN, costOf, MODELS, parseCatalog, pricesListed, worstCaseOutput } from "../src/models";
import { parseStack } from "../src/stack";

const usage = (input: number, output: number) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as never;

const LIST = {
  version: 1,
  updated: "2026-12-01",
  models: {
    "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 1.5, output: 7.5, cacheRead: 0.15 },
    "claude-sonnet-6": { label: "Sonnet 6", input: 3, output: 15, cacheRead: 0.3 },
  },
};

describe("the model list", () => {
  afterEach(() => applyCatalog(null));

  it("adds models and changes prices over the built-in list, which it can't take away", () => {
    applyCatalog(parseCatalog(LIST));
    expect(costOf("claude-sonnet-5-5", usage(1e6, 1e6))).toBeCloseTo(9);
    expect(MODELS["claude-sonnet-6"].label).toBe("Sonnet 6");
    expect(MODELS["claude-opus-5-5"]).toEqual(BUILT_IN["claude-opus-5-5"]);
    expect(pricesListed()).toBe("2026-12-01");
    const stack = { model: "claude-sonnet-6", effort: "medium" };
    expect(parseStack(JSON.stringify({ scout: stack, plan: stack, build: stack, review: stack })).build.model).toBe(
      "claude-sonnet-6",
    );

    applyCatalog(null);
    expect(MODELS).toEqual(BUILT_IN);
    expect(pricesListed()).toBe("2026-11-12");
  });

  it("prices each call on Haiku by its own prompt's length, with cache reads and writes counted in it", () => {
    const call = (input: number, read: number, written: number, output: number) =>
      ({
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: written,
        cache_read_input_tokens: read,
      }) as never;
    // Up to 100,000 tokens: $0.10 in and $0.50 out, a million.
    expect(costOf("claude-haiku-5-5", call(100_000, 0, 0, 10_000))).toBeCloseTo(0.01 + 0.005, 6);
    // Past it the whole call is dearer, a cache hit included: $0.50 in, $0.05 read, $0.625 written, $2.50 out.
    expect(costOf("claude-haiku-5-5", call(20_000, 80_000, 1_000, 10_000))).toBeCloseTo(
      0.01 + 0.004 + 0.000625 + 0.025,
      6,
    );
    // Nobody knows a prompt's length before it's sent, so the cap allows for the dearer output.
    expect(worstCaseOutput("claude-haiku-5-5", 1e6)).toBeCloseTo(2.5);
    expect(worstCaseOutput("claude-sonnet-5-5", 1e6)).toBeCloseTo(10);
    // Sonnet reads its cache at $0.10 a million.
    expect(costOf("claude-sonnet-5-5", call(0, 1e6, 0, 0))).toBeCloseTo(0.1);
  });

  it("takes a model's long-prompt prices from the list, checked like the rest", () => {
    const long = { over: 200_000, input: 6, output: 30, cacheRead: 0.6 };
    const withLong = (change: object) => ({
      ...LIST,
      models: { ...LIST.models, "claude-sonnet-6": { ...LIST.models["claude-sonnet-6"], long: { ...long, ...change } } },
    });
    expect(parseCatalog(withLong({})).models["claude-sonnet-6"].long).toEqual(long);
    expect(parseCatalog(LIST).models["claude-sonnet-6"].long).toBeUndefined();
    expect(() => parseCatalog(withLong({ over: 0 }))).toThrow(/prices/);
    expect(() => parseCatalog(withLong({ output: 0 }))).toThrow(/prices/);
    expect(() => parseCatalog(withLong({ input: "6" }))).toThrow(/prices/);
  });

  it("refuses a list it can't trust, whole", () => {
    const broken = (change: (list: typeof LIST & Record<string, unknown>) => void) => {
      const list = structuredClone(LIST) as typeof LIST & Record<string, unknown>;
      change(list);
      return () => parseCatalog(list);
    };
    expect(broken((l) => (l.version = 2 as never))).toThrow(/format/);
    expect(broken((l) => (l.updated = "soon"))).toThrow(/date/);
    expect(broken((l) => (l.models = {} as never))).toThrow(/no models/);
    // Free models would let a thread spend past its limit, since the limits rest on prices.
    expect(broken((l) => (l.models["claude-sonnet-6"].output = 0))).toThrow(/prices/);
    expect(broken((l) => (l.models["claude-sonnet-6"].input = Number.NaN))).toThrow(/prices/);
    expect(broken((l) => ((l.models as Record<string, unknown>)["gpt-6"] = l.models["claude-sonnet-6"]))).toThrow(
      /names a model/,
    );
    expect(broken((l) => (l.models["claude-sonnet-6"].label = "Sonnet\n6"))).toThrow(/names a model/);
    expect(() => parseCatalog(null)).toThrow();
    // A model OpenRouter offers free may say so, since its id does.
    const routedFree = { label: "Vendor: Small", input: 0, output: 0, cacheRead: 0 };
    expect(parseCatalog({ ...LIST, models: { "openrouter/vendor/small:free": routedFree } }).models).toHaveProperty(
      "openrouter/vendor/small:free",
    );
    expect(() => parseCatalog({ ...LIST, models: { "openrouter/vendor/small": routedFree } })).toThrow(/prices/);
  });

  it("is published in the repository, the same as the built-in list so a new install starts current", () => {
    const file = path.join(__dirname, "../../catalog/v2/models.json");
    const published = parseCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(published.models).toEqual(BUILT_IN);
    expect(published.updated).toBe("2026-11-12");
  });

  it("keeps v0.1's list to Anthropic's models, which is all v0.1 reads", () => {
    const file = path.join(__dirname, "../../catalog/models.json");
    const published = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(published.models).every((id) => id.startsWith("claude-"))).toBe(true);
  });
});
