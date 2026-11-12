import type { ModelId } from "../../runtime/src/models";
import type { Stack } from "../../runtime/src/stack";
import { planStack, type ChatGPT } from "./chatgpt";
import { localStack, type Ollama } from "./ollama";
import { freeStack } from "./openrouter";
import { geminiStack } from "./gemini";

/** A one-tap stack on a provider other than Anthropic, offered once that provider is connected. */
export interface ProviderPreset {
  name: string;
  stack: Stack;
}

/** OpenAI's models on an API key, routed like the balanced stack: the mid model plans, the next builds, and the
 *  smallest scouts and reviews. */
export const OPENAI_STACK: Stack = {
  scout: { model: "openai/gpt-6-luna", effort: "low" },
  plan: { model: "openai/gpt-6.1-sol", effort: "medium" },
  build: { model: "openai/gpt-6.1-terra", effort: "medium" },
  review: { model: "openai/gpt-6-luna", effort: "low" },
};

/** Every step on this computer, and Haiku checks each change. Review is about 1% of a routed task's cost, so this
 *  costs a fraction of a cent while Claude still decides whether the work is good. */
export function checkedStack(local: ModelId[]): Stack {
  return { ...localStack(local), review: { model: "claude-haiku-5-5", effort: "low" } };
}

/** The presets the person's connections allow, beside Anthropic's. */
export function providerPresets(connected: {
  anthropic: boolean;
  openai: boolean;
  chatgpt: ChatGPT;
  ollama: Ollama;
  /** OpenRouter's free models, largest first; empty when it isn't connected. */
  openrouterFree: ModelId[];
  /** Gemini's models on the person's key, on its free tier or paid; empty when no key is saved. */
  gemini: { free: ModelId[] } | { paid: ModelId[] };
}): ProviderPreset[] {
  const presets: ProviderPreset[] = [];
  if (connected.chatgpt.status === "signed-in" && connected.chatgpt.models.length)
    presets.push({ name: "On my ChatGPT plan", stack: planStack(connected.chatgpt.models) });
  if (connected.openai) presets.push({ name: "OpenAI", stack: OPENAI_STACK });
  if (connected.ollama.status === "ready")
    presets.push({ name: "On this computer", stack: localStack(connected.ollama.models) });
  if (connected.ollama.status === "ready" && connected.anthropic)
    presets.push({ name: "Claude checks", stack: checkedStack(connected.ollama.models) });
  if (connected.openrouterFree.length)
    presets.push({ name: "Free on OpenRouter", stack: freeStack(connected.openrouterFree) });
  if ("free" in connected.gemini && connected.gemini.free.length)
    presets.push({ name: "Gemini free tier", stack: geminiStack(connected.gemini.free) });
  if ("paid" in connected.gemini && connected.gemini.paid.length)
    presets.push({ name: "Gemini", stack: geminiStack(connected.gemini.paid) });
  return presets;
}
