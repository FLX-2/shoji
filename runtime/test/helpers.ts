import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, ModelRequest } from "../src/provider";

type Block = { text: string } | { tool: string; input: Record<string, string> };

let ids = 0;

/** A recorded-style model reply: text and tool calls, with fixed token counts. */
export function reply(blocks: Block[], usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  const content = blocks.map((b) =>
    "text" in b
      ? { type: "text", text: b.text, citations: null }
      : { type: "tool_use", id: `toolu_${++ids}`, name: b.tool, input: b.input, caller: { type: "direct" } },
  );
  return {
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: blocks.some((b) => "tool" in b) ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
  } as unknown as Anthropic.Message;
}

/** Answers each request from a script and keeps every request, so tests can check routing. */
export class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private answer: (request: ModelRequest, index: number) => Anthropic.Message) {}

  async send(request: ModelRequest) {
    this.requests.push(structuredClone(request));
    return this.answer(request, this.requests.length - 1);
  }
}

/** A throwaway git repository with one committed file. */
export function tempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-test-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "start");
  return root;
}

/** The role a request is for, read from its system prompt. */
export function roleOf(request: ModelRequest) {
  return request.system.match(/You are the (\w+)/)![1];
}

/** A scripted team that adds a greeting file. `goodBuild` decides whether its first build passes. */
export function team(goodBuild: (request: ModelRequest) => boolean, verdict = "VERDICT: APPROVE") {
  return new ScriptedProvider((request) => {
    const last = request.messages[request.messages.length - 1];
    const answered = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
    switch (roleOf(request)) {
      case "scout":
        return answered
          ? reply([{ text: "The greeting lives in src/hello.js.\nFILES: src/hello.js" }])
          : reply([{ tool: "read_file", input: { path: "src/hello.js" } }]);
      case "planner":
        return reply([{ text: "Change the greeting to 'hello, shoji'.\nDONE WHEN: the check passes." }]);
      case "builder":
        return answered
          ? reply([{ text: "Changed the greeting." }])
          : reply([
              {
                tool: "write_file",
                input: {
                  path: "src/hello.js",
                  content: goodBuild(request) ? "export default 'hello, shoji';\n" : "export default 'hello, broken';\n",
                },
              },
            ]);
      default:
        return reply([{ text: verdict }]);
    }
  });
}

/** Passes once the greeting names Shoji, so it fails before the task is done. */
export const CHECK = `node -e "process.exit(require('fs').readFileSync('src/hello.js','utf8').includes('shoji') ? 0 : 1)"`;

/** Passes until a bad build breaks the greeting, as a project's own tests would. */
export const UNBROKEN = `node -e "process.exit(require('fs').readFileSync('src/hello.js','utf8').includes('broken') ? 1 : 0)"`;
