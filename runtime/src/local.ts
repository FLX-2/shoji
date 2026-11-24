import type Anthropic from "@anthropic-ai/sdk";
import { ChatProvider } from "./chat";
import { apiName, type ModelId } from "./models";
import type { ModelProvider, ModelRequest } from "./provider";

/**
 * Local servers that speak OpenAI's Chat Completions on this computer, where each listens unless told otherwise:
 * LM Studio on 1234 and llama.cpp's llama-server on 8080. SHOJI_LOCAL_URL names another, such as one on a custom
 * port; the app reads the same setting.
 */
export const LOCAL_SERVERS: readonly { name: string; url: string }[] = [
  { name: "LM Studio", url: "http://127.0.0.1:1234" },
  { name: "llama.cpp", url: "http://127.0.0.1:8080" },
];

/** The servers to look on: the one SHOJI_LOCAL_URL names, or the usual two. */
export function localServers(given: string | undefined): { name: string; url: string }[] {
  const url = given?.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return url ? [{ name: "your local server", url }] : [...LOCAL_SERVERS];
}

/** The models a server lists at /v1/models, by their ids. */
export async function listedOn(url: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const answer = await fetcher(`${url}/v1/models`, { signal: AbortSignal.timeout(2000) });
  if (!answer.ok) return [];
  const body = (await answer.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

/**
 * A model on LM Studio or llama.cpp's server. The first call finds which server has the model and stays with it.
 * These servers set a model's context when it loads, so a step that outgrows it is told to raise it there.
 */
export class LocalProvider implements ModelProvider {
  private found = new Map<string, ChatProvider>();

  constructor(
    private servers: { name: string; url: string }[],
    private fetcher: typeof fetch = fetch,
  ) {}

  async send(request: ModelRequest): Promise<Anthropic.Message> {
    return (await this.serverFor(request.model)).send(request);
  }

  private async serverFor(model: ModelId): Promise<ChatProvider> {
    const name = apiName(model);
    const known = this.found.get(name);
    if (known) return known;
    for (const server of this.servers) {
      const models: string[] = await listedOn(server.url, this.fetcher).catch(() => []);
      if (!models.includes(name)) continue;
      const provider = new ChatProvider({
        service: server.name,
        baseURL: `${server.url}/v1`,
        // These servers check no key, but the call carries one.
        key: "local",
        fetch: this.fetcher,
        local: true,
      });
      this.found.set(name, provider);
      return provider;
    }
    const where = this.servers.map((s) => s.name).join(" or ");
    throw new Error(`Shoji couldn't find ${name} on ${where}. Start the server with the model loaded, then try again.`);
  }
}
