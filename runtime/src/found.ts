import { apiName, MODELS, type ModelId, type ModelInfo } from "./models";

// Models found on the person's own connections rather than listed: Ollama's, and their ChatGPT plan's. Kept apart
// from the providers so the app can name them without loading any provider's client.

/** The most a model's name may run to in Shoji's lists. */
const LONGEST_LABEL = 40;

/** A model pulled into Ollama, as Shoji lists it: by its own name, free, on this computer. */
export function ollamaModel(name: string): [ModelId, ModelInfo] {
  const label = name.replace(/:latest$/, "");
  return [
    `ollama/${name}`,
    {
      label: label.length > LONGEST_LABEL ? `${label.slice(0, LONGEST_LABEL - 1)}…` : label,
      input: 0,
      output: 0,
      cacheRead: 0,
      billing: "local",
    },
  ];
}

/** A model on the person's ChatGPT plan: its name, at no charge, with its API price kept for comparison when
 *  Shoji lists that model for OpenAI's API. */
export function planModel(slug: string, label = slug): [ModelId, ModelInfo] {
  const api = MODELS[`openai/${slug}`];
  return [
    `chatgpt/${slug}`,
    {
      label: label.length > LONGEST_LABEL ? `${label.slice(0, LONGEST_LABEL - 1)}…` : label,
      input: api?.input ?? 0,
      output: api?.output ?? 0,
      cacheRead: api?.cacheRead ?? 0,
      billing: "plan",
    },
  ];
}

/** Gemini's paid prices per million tokens, as Google listed them on 12 Nov 2026, and whether a key with no
 *  billing may use the model free. A listed model whose id starts with one of these is priced as it. */
export const GEMINI_PRICES: Readonly<Record<string, { input: number; output: number; cacheRead: number; free: boolean }>> = {
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15, free: true },
  "gemini-3.1-pro": { input: 2, output: 12, cacheRead: 0.2, free: false },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cacheRead: 0.025, free: true },
  "gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05, free: true },
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125, free: true },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01, free: true },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03, free: true },
};

/**
 * A Gemini model the person's key can use, or null when Shoji can't offer it: on the free tier, one Google keeps
 * for paid keys; on a paid key, one whose price Shoji doesn't know, since the spending limits rest on prices. A free
 * model Shoji has no price for is listed at nothing.
 */
export function geminiModel(id: string, name: string, free: boolean): [ModelId, ModelInfo] | null {
  const known = Object.keys(GEMINI_PRICES)
    .filter((prefix) => id.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  const price = known ? GEMINI_PRICES[known] : null;
  if (free ? price?.free === false : !price) return null;
  return [
    `gemini/${id}`,
    {
      label: name.length > LONGEST_LABEL ? `${name.slice(0, LONGEST_LABEL - 1)}…` : name,
      input: price?.input ?? 0,
      output: price?.output ?? 0,
      cacheRead: price?.cacheRead ?? 0,
      ...(free && { billing: "free" as const }),
    },
  ];
}

/** The models a stack names that live on the person's own connections, Ollama's and their ChatGPT plan's, so a
 *  run knows them however the app found them. */
export function foundModelsIn(stack: unknown): Record<ModelId, ModelInfo> {
  const seats = typeof stack === "object" && stack !== null ? Object.values(stack) : [];
  const found: [ModelId, ModelInfo][] = [];
  for (const seat of seats) {
    const model = (seat as { model?: unknown } | null)?.model;
    if (typeof model !== "string" || !/^(ollama|chatgpt)\/./.test(model)) continue;
    found.push(model.startsWith("ollama/") ? ollamaModel(apiName(model)) : planModel(apiName(model)));
  }
  return Object.fromEntries(found);
}

/** A model OpenRouter lists, by its own name and prices, which OpenRouter charges to the person's credit. */
export function routedModel(id: string, name: string, input: number, output: number, cacheRead: number): [ModelId, ModelInfo] {
  return [
    `openrouter/${id}`,
    { label: name.length > LONGEST_LABEL ? `${name.slice(0, LONGEST_LABEL - 1)}…` : name, input, output, cacheRead },
  ];
}
