import type Anthropic from "@anthropic-ai/sdk";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

export interface ModelInfo {
  label: string;
  /** Dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
}

/** Listed prices on 28 Oct 2026. Cache writes cost 1.25x input. A downloaded catalog can add to these
 *  and change their prices, but never take one away. */
const BUILT_IN_LISTED = "2026-10-28";

export const BUILT_IN: Readonly<Record<string, ModelInfo>> = {
  "claude-opus-5-5": { label: "Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** A model's API id, such as claude-sonnet-5-5: one of MODELS' keys. */
export type ModelId = string;

/** The models Shoji knows and their prices: the built-in list, with the catalog's on top. */
export const MODELS: Record<ModelId, ModelInfo> = { ...BUILT_IN };

/** The list of models and prices that Shoji downloads, so a new model or price needs no release. */
export interface Catalog {
  /** The day the list was last checked against the provider's prices, as YYYY-MM-DD. */
  updated: string;
  models: Record<ModelId, ModelInfo>;
}

/** Only Anthropic's models, for now, since that's the only provider Shoji calls. */
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,60}$/;
const MOST_MODELS = 50;

/** A price in dollars per million tokens. Free isn't allowed: the spending limits rest on prices. */
const price = (value: unknown, free = false): value is number =>
  typeof value === "number" && Number.isFinite(value) && (free ? value >= 0 : value > 0) && value <= 1000;

/** A downloaded catalog, checked field by field. Throws on anything malformed, so a bad file changes nothing. */
export function parseCatalog(value: unknown): Catalog {
  const data = value as { version?: unknown; updated?: unknown; models?: unknown } | null;
  if (typeof data !== "object" || data === null || data.version !== 1) {
    throw new Error("The model list isn't in a format this Shoji reads.");
  }
  if (typeof data.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
    throw new Error("The model list has no date.");
  }
  if (typeof data.models !== "object" || data.models === null || Array.isArray(data.models)) {
    throw new Error("The model list has no models.");
  }
  const entries = Object.entries(data.models as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MOST_MODELS) throw new Error("The model list has no models.");
  const models: Record<ModelId, ModelInfo> = {};
  for (const [id, entry] of entries) {
    const { label: named, input, output, cacheRead } = (entry ?? {}) as Partial<Record<keyof ModelInfo, unknown>>;
    const label = typeof named === "string" ? named.trim() : "";
    if (!MODEL_ID.test(id) || !label || label.length > 40 || /[\u0000-\u001f]/.test(label)) {
      throw new Error(`The model list names a model it can't: ${id.slice(0, 80)}.`);
    }
    if (!price(input) || !price(output) || !price(cacheRead, true)) {
      throw new Error(`The model list's prices for ${id} aren't usable.`);
    }
    models[id] = { label, input, output, cacheRead };
  }
  return { updated: data.updated, models };
}

let listed = BUILT_IN_LISTED;

/** The day the prices in MODELS were listed, as YYYY-MM-DD. */
export const pricesListed = () => listed;

/** Puts a catalog's models and prices in place of the last one's, over the built-in list. */
export function applyCatalog(catalog: Catalog | null): void {
  for (const id of Object.keys(MODELS)) delete MODELS[id];
  Object.assign(MODELS, BUILT_IN, catalog?.models);
  listed = catalog?.updated ?? BUILT_IN_LISTED;
}

const CACHE_WRITE = 1.25;

export function costOf(model: ModelId, usage: Anthropic.Usage): number {
  const p = MODELS[model];
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens * p.input +
      written * p.input * CACHE_WRITE +
      read * p.cacheRead +
      usage.output_tokens * p.output) /
    1e6
  );
}

/** The most one call can cost in output, used to stop before a call could cross the cap. */
export function worstCaseOutput(model: ModelId, maxTokens: number): number {
  return (maxTokens * MODELS[model].output) / 1e6;
}
