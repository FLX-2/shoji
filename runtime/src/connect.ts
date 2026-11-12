import { providerOf, type ModelId, type ProviderId } from "./models";
import { OllamaProvider, ollamaUrl } from "./ollama";
import { OpenAIError, OpenAIProvider } from "./openai";
import { ChatProvider, GEMINI_API } from "./chat";

/** OpenRouter's API, which takes OpenAI's Responses format for every model it routes to. */
export const OPENROUTER_API = "https://openrouter.ai/api/v1";
import { AnthropicProvider, notConnected, type ModelProvider, Providers } from "./provider";

/** Where the app hands a run each provider's key. The keys never appear in a flag, where other programs see them. */
export const KEY_ENV: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
  anthropic: ["SHOJI_API_KEY", "ANTHROPIC_API_KEY"],
  openai: ["SHOJI_OPENAI_KEY", "OPENAI_API_KEY"],
  openrouter: ["SHOJI_OPENROUTER_KEY", "OPENROUTER_API_KEY"],
  gemini: ["SHOJI_GEMINI_KEY", "GEMINI_API_KEY"],
};

/** A ChatGPT access token lasts an hour; one this close to its end is renewed before a call. */
const RENEW_BEFORE = 5 * 60 * 1000;

const keyOf = (env: NodeJS.ProcessEnv, provider: ProviderId) =>
  KEY_ENV[provider]?.map((name) => env[name]?.trim()).find(Boolean);

export interface Connections {
  /** Anthropic's API address, for development against a stand-in. */
  anthropicUrl?: string;
  /** Gets a fresh ChatGPT token from whoever keeps the sign-in, or null once the person has signed out. */
  renew?: () => Promise<{ token: string; expires: number } | null>;
  /** The time now, in ms; tests set it. */
  now?: () => number;
}

/** A ChatGPT sign-in's token, renewed through `renew` when it's near its end or was turned down. */
export function planToken(token: string, expires: number, options: Connections) {
  let current = { token, expires };
  const now = options.now ?? Date.now;
  return async (fresh = false) => {
    if (fresh || current.expires - now() < RENEW_BEFORE) {
      const renewed = options.renew ? await options.renew() : null;
      if (!renewed) throw new OpenAIError(401, "signed_out", "signed out");
      current = renewed;
    }
    return current.token;
  };
}

/** The providers this run can reach, from the keys in its environment, and Ollama where OLLAMA_HOST says. */
export function connect(env: NodeJS.ProcessEnv, options: Connections = {}): Providers {
  const connected: Partial<Record<ProviderId, ModelProvider>> = {};
  const anthropic = keyOf(env, "anthropic");
  if (anthropic) connected.anthropic = new AnthropicProvider(anthropic, options.anthropicUrl);
  const openai = keyOf(env, "openai");
  if (openai) connected.openai = new OpenAIProvider({ plan: false, credential: async () => openai });
  const openrouter = keyOf(env, "openrouter");
  if (openrouter)
    connected.openrouter = new OpenAIProvider({
      plan: false,
      service: "OpenRouter",
      baseURL: OPENROUTER_API,
      headers: { "HTTP-Referer": "https://github.com/FLX-2/shoji", "X-Title": "Shoji" },
      credential: async () => openrouter,
    });
  const gemini = keyOf(env, "gemini");
  if (gemini) connected.gemini = new ChatProvider({ service: "Gemini", baseURL: GEMINI_API, key: gemini });
  const plan = env.SHOJI_CHATGPT_TOKEN?.trim();
  if (plan)
    connected.chatgpt = new OpenAIProvider({
      plan: true,
      credential: planToken(plan, Number(env.SHOJI_CHATGPT_EXPIRES) || 0, options),
    });
  // Ollama needs no key, so it's always there to try. A call to it when it isn't running says so.
  connected.ollama = new OllamaProvider(ollamaUrl(env.OLLAMA_HOST));
  return new Providers(connected);
}

/** Why a run can't use these models, or null when every one's provider is connected. */
export function unreachable(providers: Providers, models: ModelId[]): string | null {
  const missing = models.find((model) => !providers.reaches(model));
  return missing === undefined ? null : notConnected(providerOf(missing));
}
