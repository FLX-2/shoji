// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_TOKENS } from "../src/agent";
import type { RuntimeEvent } from "../src/events";
import { commandEnv, runCommand } from "../src/commands";
import { LEAST_OUTPUT } from "../src/meter";
import { costOf } from "../src/models";
import { runThread } from "../src/pipeline";
import { defaultChecks } from "../src/project";
import { AnthropicProvider, type ModelProvider } from "../src/provider";
import { STACKS } from "../src/stack";
import { runTool } from "../src/tools";
import { Workspace } from "../src/workspace";
import { CHECK, roleOf, team, tempRepo, UNBROKEN } from "./helpers";

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
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    const link = path.join(root, "escape");
    // A junction on Windows, which needs no admin rights; the type is ignored elsewhere.
    fs.symlinkSync(outside, link, "junction");
    expect(runTool(ws, [], "read_file", { path: "escape/secret.txt" })).toMatch(/outside the project/);
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

describe("project commands", () => {
  it("never pass the API key to the project's scripts", () => {
    const env = commandEnv({ PATH: "/bin", SHOJI_API_KEY: "sk-1", ANTHROPIC_API_KEY: "sk-2", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", CI: "1", FORCE_COLOR: "0" });

    const saved = process.env.SHOJI_API_KEY;
    process.env.SHOJI_API_KEY = "sk-test-not-real";
    try {
      const root = tempRepo({ "a.txt": "" });
      const result = runCommand(root, `node -e "process.stdout.write(String(process.env.SHOJI_API_KEY))"`);
      expect(result.output).toBe("undefined");
    } finally {
      if (saved === undefined) delete process.env.SHOJI_API_KEY;
      else process.env.SHOJI_API_KEY = saved;
    }
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


async function run(provider: ModelProvider, cap = 1, changes?: { plan: string; notes: string }, checks = [CHECK]) {
  const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
  const events: RuntimeEvent[] = [];
  const result = await runThread({
    task: "Make the greeting say hello to Shoji.",
    stack: STACKS.balanced,
    provider,
    workspace: new Workspace(root),
    checks,
    cap,
    changes,
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

  it("reports each tool call and what each step wrote", async () => {
    const { events } = await run(team(() => true));

    const tools = events.flatMap((e) => (e.type === "tool" ? [`${e.step} ${e.tool} ${e.target}`] : []));
    expect(tools).toEqual(["scout read_file src/hello.js", "build write_file src/hello.js"]);
    const outputs = Object.fromEntries(events.flatMap((e) => (e.type === "step" && e.status === "done" ? [[e.step, e.output]] : [])));
    expect(outputs.plan).toMatch(/^Change the greeting/);
    expect(outputs.review).toBe("VERDICT: APPROVE");
  });

  it("builds requested changes on the earlier plan, without scouting or planning again", async () => {
    const provider = team(() => true);
    const { result, events } = await run(provider, 1, { plan: "Change the greeting.", notes: "Say hello to Shoji." });

    expect(result.status).toBe("ready");
    expect(result.plan).toBe("Change the greeting.");
    const steps = events.flatMap((e) => (e.type === "step" && e.status === "running" ? [e.step] : []));
    expect(steps).toEqual(["changes", "review"]);
    const build = provider.requests.find((r) => roleOf(r) === "builder")!;
    expect(build.messages[0].content).toContain("asked for these changes:\nSay hello to Shoji.");
  });

  it("moves the build up to the plan model after checks fail twice", async () => {
    // Only the plan model writes a passing build.
    const provider = team((request) => request.model === "claude-opus-5-5");
    const { result, events } = await run(provider, 1, undefined, [UNBROKEN]);

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

  it("shows a friendly message when Anthropic rejects the API key", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const { result } = await run(new AnthropicProvider("bad-key", `http://127.0.0.1:${port}`));
      expect(result.status).toBe("failed");
      expect(result.reason).toBe("Anthropic didn't accept your API key. Check it in Settings.");
      expect(result.reason).not.toContain("authentication_error");
    } finally {
      server.close();
    }
  });

  it("stops before a call could pass the cap, and never goes over it", async () => {
    const cap = 0.05; // Enough for the scout, but the planner couldn't write 4k tokens of Opus, $0.08.
    const provider = team(() => true);
    const { result } = await run(provider, cap);

    expect(result.status).toBe("stopped");
    expect(result.reason).toMatch(/limit/);
    expect(result.cost).toBeLessThanOrEqual(cap);
    expect(provider.requests.every((r) => roleOf(r) === "scout")).toBe(true);
  });

  it("stops after the plan when asked, then builds the plan the person approved", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const go = (provider: ModelProvider, extra: object) =>
      runThread({
        task: "Make the greeting say hello to Shoji.",
        stack: STACKS.balanced,
        provider,
        workspace: new Workspace(root),
        checks: [CHECK],
        cap: 1,
        emit: () => {},
        ...extra,
      });

    const planning = team(() => true);
    const planned = await go(planning, { planOnly: true });
    expect(planned.status).toBe("planned");
    expect(planned.plan).toContain("hello, shoji");
    expect(planned.diff).toBe("");
    expect(planning.requests.map(roleOf)).toEqual(["scout", "scout", "planner"]);

    const replanning = team(() => true);
    await go(replanning, { planOnly: true, replan: { plan: planned.plan, notes: "Use an exclamation mark." } });
    const replan = JSON.stringify(replanning.requests.find((r) => roleOf(r) === "planner")!.messages);
    expect(replan).toContain("An earlier plan for this task");
    expect(replan).toContain("Use an exclamation mark.");

    const building = team(() => true);
    const built = await go(building, { approved: "Say hello to Shoji, exactly as approved." });
    expect(built.status).toBe("ready");
    expect(built.plan).toBe("Say hello to Shoji, exactly as approved.");
    expect(building.requests.some((r) => roleOf(r) === "scout" || roleOf(r) === "planner")).toBe(false);
    expect(JSON.stringify(building.requests[0].messages)).toContain("exactly as approved");
  });

  it("says when a check can't run at all, and spends nothing trying to fix it", async () => {
    const provider = team(() => true);
    const { result, events } = await run(provider, 1, undefined, ["shoji-no-such-program --version"]);

    expect(result.status).toBe("needs-work");
    expect(result.reason).toMatch(/couldn't run shoji-no-such-program --version: its program isn't on this computer/);
    expect(result.checks[0].missing).toBe(true);
    expect(result.escalated).toBe(false);
    expect(events.some((e) => e.type === "step" && e.step.startsWith("fix"))).toBe(false);
    expect(provider.requests.filter((r) => roleOf(r) === "reviewer")).toHaveLength(1);
    expect(JSON.stringify(provider.requests.at(-1)!.messages)).toContain(
      "couldn't run, its program isn't installed here",
    );
  });

  it("leaves a check that failed before any change alone, and says so", async () => {
    const ALWAYS_FAILS = `node -e "process.exit(1)"`;
    const provider = team(() => true);
    const { result, events } = await run(provider, 1, undefined, [UNBROKEN, ALWAYS_FAILS]);

    expect(result.status).toBe("ready");
    expect(result.failingBefore).toEqual([ALWAYS_FAILS]);
    expect(result.checks.map((c) => [c.ok, c.failedBefore])).toEqual([
      [true, undefined],
      [false, true],
    ]);
    expect(result.reason).toMatch(/was already failing before Shoji changed anything, so it left that failure alone/);
    expect(events.some((e) => e.type === "step" && e.step.startsWith("fix"))).toBe(false);
    const build = provider.requests.find((r) => roleOf(r) === "builder")!;
    expect(build.messages[0].content).toContain(`These checks already failed before any change`);
    expect(JSON.stringify(provider.requests.at(-1)!.messages)).toContain("it failed before this change too");
  });

  it("still fixes a check the build broke, and keeps leaving the old failure to later runs", async () => {
    const ALWAYS_FAILS = `node -e "process.exit(1)"`;
    const provider = team(() => false);
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const result = await runThread({
      task: "Make the greeting say hello to Shoji.",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [UNBROKEN, ALWAYS_FAILS],
      cap: 1,
      changes: { plan: "Change the greeting.", notes: "Keep going." },
      failingBefore: [ALWAYS_FAILS],
      emit: () => {},
    });

    // A changes run can't see the project as it was, so it's told which checks failed then.
    expect(result.checks.map((c) => [c.ok, c.failedBefore])).toEqual([
      [false, undefined],
      [false, true],
    ]);
    expect(result.status).toBe("needs-work");
    expect(provider.requests.filter((r) => roleOf(r) === "builder").length).toBeGreaterThan(2);
    const fixes = provider.requests.filter((r) => roleOf(r) === "builder" && !Array.isArray(r.messages.at(-1)!.content));
    const fix = fixes[fixes.length - 1];
    expect(fix.messages[0].content).toContain(`${UNBROKEN} failed`);
    expect(fix.messages[0].content).not.toContain(`${ALWAYS_FAILS} failed`);
  });

  it("shortens a call near the cap instead of stopping, while it still has room to work", async () => {
    const cap = 0.3; // The planner's worst case is 16k tokens of Opus, $0.32, so it gets a little less.
    const provider = team(() => true);
    const { result } = await run(provider, cap);

    expect(result.status).toBe("ready");
    const plan = provider.requests.find((r) => roleOf(r) === "planner")!;
    expect(plan.maxTokens).toBeLessThan(MAX_TOKENS);
    expect(plan.maxTokens).toBeGreaterThanOrEqual(LEAST_OUTPUT);
    expect(result.cost).toBeLessThanOrEqual(cap);
  });
});
