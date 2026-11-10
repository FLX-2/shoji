import type { Stack } from "../../runtime/src/stack";
import { planStack, type ChatGPT } from "./chatgpt";
import { localStack, type Ollama } from "./ollama";

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

/** The presets the person's connections allow, beside Anthropic's. */
export function providerPresets(connected: { openai: boolean; chatgpt: ChatGPT; ollama: Ollama }): ProviderPreset[] {
  const presets: ProviderPreset[] = [];
  if (connected.chatgpt.status === "signed-in" && connected.chatgpt.models.length)
    presets.push({ name: "On my ChatGPT plan", stack: planStack(connected.chatgpt.models) });
  if (connected.openai) presets.push({ name: "OpenAI", stack: OPENAI_STACK });
  if (connected.ollama.status === "ready")
    presets.push({ name: "On this computer", stack: localStack(connected.ollama.models) });
  return presets;
}
