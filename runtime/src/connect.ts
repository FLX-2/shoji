import { providerOf, type ModelId, type ProviderId } from "./models";
import { AnthropicProvider, notConnected, type ModelProvider, Providers } from "./provider";

/** Where the app hands a run each provider's key. The keys never appear in a flag, where other programs see them. */
export const KEY_ENV: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
  anthropic: ["SHOJI_API_KEY", "ANTHROPIC_API_KEY"],
};

const keyOf = (env: NodeJS.ProcessEnv, provider: ProviderId) =>
  KEY_ENV[provider]?.map((name) => env[name]?.trim()).find(Boolean);

export interface Connections {
  /** Anthropic's API address, for development against a stand-in. */
  anthropicUrl?: string;
}

/** The providers this run can reach, from the keys in its environment. */
export function connect(env: NodeJS.ProcessEnv, options: Connections = {}): Providers {
  const connected: Partial<Record<ProviderId, ModelProvider>> = {};
  const anthropic = keyOf(env, "anthropic");
  if (anthropic) connected.anthropic = new AnthropicProvider(anthropic, options.anthropicUrl);
  return new Providers(connected);
}

/** Why a run can't use these models, or null when every one's provider is connected. */
export function unreachable(providers: Providers, models: ModelId[]): string | null {
  const missing = models.find((model) => !providers.reaches(model));
  return missing === undefined ? null : notConnected(providerOf(missing));
}
