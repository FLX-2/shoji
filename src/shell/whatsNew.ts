/** What each minor release brings, said once on the first open after the update. A release with nothing worth
 *  saying has no entry, and says nothing. */
export const WHATS_NEW: Record<string, string> = {
  "0.2": "Shoji 0.2 runs more models: ChatGPT, OpenAI, OpenRouter and Ollama.",
};

/** "0.2" for 0.2.3. Point releases share their minor release's news. */
export const minorOf = (version: string) => version.split(".").slice(0, 2).join(".");

/** The news to show on this open, if any: only to someone who used an earlier version, never at a first setup,
 *  and once per release. */
export function whatsNew(version: string, seen: string | null, setupDone: boolean): string | null {
  const minor = minorOf(version);
  if (!setupDone || seen === minor) return null;
  return WHATS_NEW[minor] ?? null;
}
