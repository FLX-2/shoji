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
