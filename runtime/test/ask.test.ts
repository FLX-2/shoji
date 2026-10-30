// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import type { ModelRequest } from "../src/provider";
import { runThread } from "../src/pipeline";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

/** Writes a marker file, so a test can tell whether it ran. */
const SETUP = `node -e "require('fs').writeFileSync('ran.txt', 'yes')"`;

/** The usual team, except the builder runs SETUP twice, then writes the greeting. */
function teamThatRuns() {
  const scripted = team(() => true);
  const results = (r: ModelRequest) => r.messages.filter((m) => m.role === "user" && Array.isArray(m.content)).length;
  return new ScriptedProvider((request, index) => {
    if (roleOf(request) !== "builder") return scripted.answer(request, index);
    const done = results(request);
    if (done < 2) return reply([{ tool: "run_command", input: { command: SETUP } }]);
    if (done === 2) return reply([{ tool: "write_file", input: { path: "src/hello.js", content: "export default 'hello, shoji';\n" } }]);
    return reply([{ text: "Changed the greeting." }]);
  });
}

async function run(options: { ask?: (command: string) => Promise<boolean>; allowed?: string[] }) {
  const provider = teamThatRuns();
  const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
  const events: RuntimeEvent[] = [];
  const result = await runThread({
    task: "Make the greeting say hello to Shoji.",
    stack: STACKS.balanced,
    provider,
    workspace: new Workspace(root),
    checks: [CHECK],
    cap: 1,
    emit: (e) => events.push(e),
    ...options,
  });
  const toolResults = provider.requests
    .filter((r) => roleOf(r) === "builder")
    .at(-1)!
    .messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .flatMap((b) => (b.type === "tool_result" ? [String(b.content)] : []));
  return { result, events, ran: fs.existsSync(path.join(root, "ran.txt")), toolResults };
}

describe("commands beyond the checks", () => {
  it("asks the person once, then runs the command they allowed", async () => {
    const asked: string[] = [];
    const { result, events, ran } = await run({ ask: async (command) => (asked.push(command), true) });

    expect(asked).toEqual([SETUP]);
    expect(ran).toBe(true);
    // Listed as run once allowed, not while it waits.
    const order = events.filter((e) => e.type === "ask" || e.type === "answer" || (e.type === "tool" && e.tool === "run_command"));
    expect(order.map((e) => e.type)).toEqual(["ask", "answer", "tool", "tool"]);
    expect(events.filter((e) => e.type === "ask" || e.type === "answer")).toEqual([
      { type: "ask", step: "build", command: SETUP },
      { type: "answer", step: "build", command: SETUP, allowed: true },
    ]);
    expect(result.status).toBe("ready");
  });

  it("tells the builder to do without a command the person turned down", async () => {
    const { ran, toolResults, events } = await run({ ask: async () => false });
    expect(ran).toBe(false);
    expect(events.some((e) => e.type === "tool" && e.tool === "run_command")).toBe(false);
    expect(toolResults).toEqual([
      `Error: the person didn't allow ${SETUP}. Do the task without it.`,
      `Error: the person didn't allow ${SETUP}. Do the task without it.`,
      "Written.",
    ]);
  });

  it("runs a command the person already allowed in the project without asking", async () => {
    const { ran, events } = await run({ allowed: [SETUP], ask: async () => false });
    expect(ran).toBe(true);
    expect(events.some((e) => e.type === "ask")).toBe(false);
  });

  it("refuses anything but the checks when nobody can be asked", async () => {
    const { ran, toolResults } = await run({});
    expect(ran).toBe(false);
    expect(toolResults[0]).toMatch(/^Error: only these commands can run/);
  });
});
