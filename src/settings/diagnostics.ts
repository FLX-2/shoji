import { MODELS } from "../../runtime/src/models";
import { ROLES, type Stack } from "../../runtime/src/stack";
import type { KeyStatus } from "../bridge";
import type { Thread } from "../thread/useThread";

export interface DiagnosticsInput {
  version: string;
  /** The browser engine's own description of the system, which names the OS. */
  userAgent: string;
  anthropic: KeyStatus | null;
  openai: KeyStatus | null;
  chatgpt: string;
  openrouter: string;
  /** Gemini's key status and the tier the person chose. */
  gemini?: string;
  ollama: { status: string; models: number };
  stack: Stack;
  pricesListed: string;
  threads: Thread[];
  /** The last problem Shoji showed outside a thread, if any. */
  lastShown: string | null;
}

const key = (status: KeyStatus | null) =>
  !status ? "unknown" : status.saved ? "saved" : status.fromEnv ? "from the shell" : "none";

/** The last thing that went wrong in a thread: a run that couldn't start, ended badly, or failed. */
export function lastThreadProblem(threads: Thread[]): string | null {
  let found: string | null = null;
  for (const thread of threads) {
    for (const turn of thread.turns) {
      if (turn.error) found = turn.error;
      else if (turn.exit && turn.exit.code !== 0 && turn.exit.error.trim()) found = turn.exit.error.trim();
      for (const event of turn.events)
        if (event.type === "result" && event.result.status === "failed" && event.result.reason)
          found = event.result.reason;
    }
  }
  return found;
}

/** What a bug report needs, as plain text: versions, which providers are connected and the last error. No keys,
 *  no code, no tasks and no account names. */
export function diagnostics(d: DiagnosticsInput): string {
  const problem = lastThreadProblem(d.threads) ?? d.lastShown;
  return [
    `Shoji ${d.version}`,
    `System: ${d.userAgent}`,
    `Anthropic key: ${key(d.anthropic)}`,
    `OpenAI key: ${key(d.openai)}`,
    `ChatGPT: ${d.chatgpt}`,
    `OpenRouter: ${d.openrouter}`,
    ...(d.gemini ? [`Gemini: ${d.gemini}`] : []),
    `Ollama: ${d.ollama.status}, ${d.ollama.models} models that can use tools`,
    `Stack: ${ROLES.map((role) => `${role} ${d.stack[role].model} (${d.stack[role].effort})`).join(", ")}`,
    `Models known: ${Object.keys(MODELS).length}, prices listed ${d.pricesListed}`,
    `Last error: ${problem ? problem.replace(/\s+/g, " ").slice(0, 600) : "none"}`,
  ].join("\n");
}
