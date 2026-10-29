// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { costOf } from "../src/models";
import { runThread } from "../src/pipeline";
import { defaultChecks } from "../src/project";
import type { ModelRequest } from "../src/provider";
import { STACKS } from "../src/stack";
import { runTool } from "../src/tools";
import { Workspace } from "../src/workspace";
import { reply, ScriptedProvider, tempRepo } from "./helpers";

const usage = (u: object) => ({ input_tokens: 0, output_tokens: 0, ...u }) as Parameters<typeof costOf>[1];

describe("cost", () => {
  it("prices input, output and cache at the listed rates", () => {
    // Opus: 1M in at $4, 100k out at $20/M, 1M cache reads at $0.20, 100k cache writes at 1.25 x $4.
    const cost = costOf(
      "claude-opus-5-5",
      usage({ input_tokens: 1e6, output_tokens: 1e5, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e5 }),
    );
    expect(cost).toBeCloseTo(4 + 2 + 0.2 + 0.5);
  });
});

describe("workspace and tools", () => {
  const root = tempRepo({ "src/a.ts": "export const a = 1;\nexport const b = 1;\n", "node_modules/x/index.js": "" });
  const ws = new Workspace(root);

  it("refuses paths outside the project or in skipped folders", () => {
    expect(runTool(ws, [], "read_file", { path: "../../etc/passwd" })).toMatch(/outside the project/);
    expect(runTool(ws, [], "read_file", { path: "/etc/passwd" })).toMatch(/outside the project/);
    expect(runTool(ws, [], "write_file", { path: "node_modules/x/index.js", content: "" })).toMatch(/doesn't touch/);
    expect(runTool(ws, [], "write_file", { path: ".git/config", content: "" })).toMatch(/doesn't touch/);
  });

  it("refuses a symlink that leads out of the project", () => {
    const link = path.join(root, "escape");
    fs.symlinkSync("/etc", link);
    expect(runTool(ws, [], "read_file", { path: "escape/hostname" })).toMatch(/outside the project/);
    fs.unlinkSync(link);
  });

  it("lists, searches and edits files", () => {
    expect(runTool(ws, [], "list_files", { path: "." })).toBe("src/a.ts");
    expect(runTool(ws, [], "search", { pattern: "const b" })).toBe("src/a.ts:2: export const b = 1;");
    expect(runTool(ws, [], "replace_in_file", { path: "src/a.ts", old_text: "= 1", new_text: "= 2" })).toMatch(
      /2 times/,
    );
    expect(runTool(ws, [], "replace_in_file", { path: "src/a.ts", old_text: "b = 1", new_text: "b = 2" })).toBe(
      "Replaced.",
    );
    expect(fs.readFileSync(path.join(root, "src/a.ts"), "utf8")).toContain("b = 2");
  });

  it("runs only the allowed commands", () => {
    expect(runTool(ws, ["node -e 0"], "run_command", { command: "rm -rf src" })).toMatch(/only these commands/);
    expect(fs.existsSync(path.join(root, "src/a.ts"))).toBe(true);
    expect(runTool(ws, ["node -e 0"], "run_command", { command: "node -e 0" })).toMatch(/^Passed/);
  });
});

describe("default checks", () => {
  it("uses the project's own scripts with its package manager", () => {
    const root = tempRepo({
      "package.json": JSON.stringify({ scripts: { test: "vitest", build: "vite build", typecheck: "tsc" } }),
      "pnpm-lock.yaml": "",
    });
    expect(defaultChecks(root)).toEqual(["pnpm run typecheck", "pnpm run test"]);
  });
});

/** The role a request is for, read from its system prompt. */
function roleOf(request: ModelRequest) {
  return request.system.match(/You are the (\w+)/)![1];
}

/** A scripted team that adds a greeting file. `goodBuild` decides whether its first build passes. */
function team(goodBuild: (request: ModelRequest) => boolean, verdict = "VERDICT: APPROVE") {
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
                  content: goodBuild(request) ? "export default 'hello, shoji';\n" : "export default 'hello';\n",
                },
              },
            ]);
      default:
        return reply([{ text: verdict }]);
    }
  });
}

const CHECK = `node -e "process.exit(require('fs').readFileSync('src/hello.js','utf8').includes('shoji') ? 0 : 1)"`;

async function run(provider: ScriptedProvider, cap = 1) {
  const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
  const events: RuntimeEvent[] = [];
  const result = await runThread({
    task: "Make the greeting say hello to Shoji.",
    stack: STACKS.balanced,
    provider,
    workspace: new Workspace(root),
    checks: [CHECK],
    cap,
    emit: (e) => events.push(e),
  });
  return { result, events, root };
}

describe("thread pipeline", () => {
  it("routes each role to its model and finishes ready", async () => {
    const provider = team(() => true);
    const { result, events } = await run(provider);

    expect(result.status).toBe("ready");
    expect(result.diff).toContain("+export default 'hello, shoji';");
    expect(result.escalated).toBe(false);
    const models = Object.fromEntries(provider.requests.map((r) => [roleOf(r), r.model]));
    expect(models).toEqual({
      scout: "claude-haiku-5-5",
      planner: "claude-opus-5-5",
      builder: "claude-sonnet-5-5",
      reviewer: "claude-haiku-5-5",
    });
    const steps = events.flatMap((e) => (e.type === "step" && e.status === "running" ? [e.step] : []));
    expect(steps).toEqual(["scout", "plan", "build", "review"]);
    const calls = events.filter((e) => e.type === "call");
    expect(calls).toHaveLength(provider.requests.length);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.cost).toBeCloseTo(Object.values(result.costByRole).reduce((a, b) => a + b, 0));
  });

  it("moves the build up to the plan model after checks fail twice", async () => {
    // Only the plan model writes a passing build.
    const provider = team((request) => request.model === "claude-opus-5-5");
    const { result, events } = await run(provider);

    expect(result.status).toBe("ready");
    expect(result.escalated).toBe(true);
    const escalation = events.find((e) => e.type === "escalate");
    expect(escalation).toMatchObject({ from: "claude-sonnet-5-5", to: "claude-opus-5-5" });
    const builders = provider.requests.filter((r) => roleOf(r) === "builder").map((r) => r.model);
    expect(builders).toContain("claude-opus-5-5");
    expect(builders.filter((m) => m === "claude-sonnet-5-5").length).toBeGreaterThan(0);
  });

  it("reports needs-work when the reviewer keeps asking for fixes", async () => {
    const { result } = await run(team(() => true, "VERDICT: FIX\n1. Say it louder."));
    expect(result.status).toBe("needs-work");
    expect(result.review).toMatch(/^VERDICT: FIX/);
  });

  it("stops before a call could pass the cap, and never goes over it", async () => {
    const cap = 0.3; // Enough for the scout, but not for the planner's worst case: 16k tokens of Opus, $0.32.
    const provider = team(() => true);
    const { result } = await run(provider, cap);

    expect(result.status).toBe("stopped");
    expect(result.reason).toMatch(/limit/);
    expect(result.cost).toBeLessThanOrEqual(cap);
    expect(provider.requests.every((r) => roleOf(r) === "scout")).toBe(true);
  });
});
