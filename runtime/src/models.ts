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

/** Listed prices on 28 Oct 2026. Cache writes cost 1.25x input. */
export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { label: "Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
} satisfies Record<string, ModelInfo>;

export type ModelId = keyof typeof MODELS;

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
