// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCatalog, BUILT_IN, costOf, MODELS, parseCatalog, pricesListed } from "../src/models";
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
    expect(pricesListed()).toBe("2026-10-28");
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
  });

  it("is published in the repository, the same as the built-in list so a new install starts current", () => {
    const file = path.join(__dirname, "../../catalog/models.json");
    const published = parseCatalog(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(published.models).toEqual(BUILT_IN);
    expect(published.updated).toBe("2026-10-28");
  });
});
