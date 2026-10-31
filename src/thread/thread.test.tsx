import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CallRecord, RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import type { ModelId } from "../../runtime/src/models";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import { STACKS, type Role } from "../../runtime/src/stack";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { foldRun, formatCost, stepLabel } from "./fold";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const running = (step: string, role: Role, model: ModelId): RuntimeEvent => ({
  type: "step",
  step,
  role,
  model,
  status: "running",
});
const done = (step: string, role: Role, model: ModelId, output = ""): RuntimeEvent => ({
  type: "step",
  step,
  role,
  model,
  status: "done",
  output,
});
const call = (step: string, role: Role, model: ModelId, cost: number): RuntimeEvent => ({
  type: "call",
  call: { step, role, model, cost } as CallRecord,
});
const result = (status: ThreadResult["status"], cost: number, extra: Partial<ThreadResult> = {}): RuntimeEvent => ({
  type: "result",
  result: {
    status,
    plan: "1. Add a billing toggle.",
    diff: "",
    review: "VERDICT: APPROVE",
    checks: [{ command: "pnpm test", ok: true, output: "" }],
    escalated: false,
    cost,
    costByRole: { scout: 0, plan: 0, build: 0, review: 0 },
    ...extra,
  },
});

describe("folding a run", () => {
  it("puts tools, checks, costs and escalations on their steps", () => {
    const run = foldRun([
      running("build", "build", SONNET),
      { type: "tool", step: "build", tool: "write_file", target: "src/Card.tsx" },
      call("build", "build", SONNET, 0.02),
      done("build", "build", SONNET, "Added the toggle."),
      { type: "checks", step: "build", results: [{ command: "pnpm test", ok: false, output: "1 failed" }] },
      { type: "escalate", step: "fix-2", from: SONNET, to: OPUS, reason: "Checks failed twice." },
      running("fix-2", "build", OPUS),
      call("fix-2", "build", OPUS, 0.05),
    ]);

    expect(run.steps.map((s) => [s.name, s.running])).toEqual([
      ["build", false],
      ["fix-2", true],
    ]);
    expect(run.steps[0]).toMatchObject({ output: "Added the toggle.", tools: [{ target: "src/Card.tsx" }] });
    expect(run.steps[0].checks?.[0].ok).toBe(false);
    expect(run.steps[1].escalation).toMatchObject({ to: OPUS });
    expect(run.cost).toBeCloseTo(0.07);
    expect(stepLabel(run.steps, 0)).toBe("Made the change");
    expect(stepLabel(run.steps, 1)).toBe("Fixing the failing checks");
  });
});

describe("a run cut short", () => {
  it("marks a step cut short by the end of the run as unfinished", () => {
    const run = foldRun([
      running("scout", "scout", HAIKU),
      done("scout", "scout", HAIKU),
      running("plan", "plan", OPUS),
      result("failed", 0.01, { reason: "Boom" }),
    ]);

    expect(run.steps[0]).toMatchObject({ running: false });
    expect(run.steps[0].unfinished).toBeFalsy();
    expect(run.steps[1]).toMatchObject({ running: false, unfinished: true });
    expect(stepLabel(run.steps, 0)).toBe("Read the code");
    expect(stepLabel(run.steps, 1)).toBe("Planning the change");
  });
});

describe("formatting a cost", () => {
  it("shows nothing spent with two decimals", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("shows amounts under a cent with four decimals", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
    expect(formatCost(0.0001)).toBe("$0.0001");
  });

  it("shows amounts under ten cents with three decimals", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.05)).toBe("$0.050");
    expect(formatCost(0.099)).toBe("$0.099");
  });

  it("shows ten cents or more with two decimals", () => {
    expect(formatCost(0.1)).toBe("$0.10");
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.5)).toBe("$1.50");
  });
});

describe("a thread in the app", () => {
  beforeEach(() => localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", cap: 0.5 })));
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function startThread(fake = fakeBridge()) {
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add an annual toggle to the pricing cards" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    return fake;
  }

  it("starts the runtime on the open project and lights the running step with its model", async () => {
    const fake = await startThread();
    // Threads pause after the plan unless the person turns that off.
    expect(fake.calls.starts).toEqual([
      {
        repo: "/work/pricing-page",
        task: "Add an annual toggle to the pricing cards",
        stack: STACKS.balanced,
        cap: 0.5,
        planOnly: true,
        privateFiles: DEFAULT_PRIVATE,
        ask: "Add an annual toggle to the pricing cards",
      },
    ]);

    fake.emit(running("scout", "scout", HAIKU), call("scout", "scout", HAIKU, 0.001), done("scout", "scout", HAIKU));
    fake.emit(running("plan", "plan", OPUS));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add an annual toggle to the pricing cards");
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("running");
    const steps = Array.from(document.querySelectorAll(".st"));
    expect(steps.map((s) => s.className)).toEqual(["st done", "st now"]);
    expect(steps[0].textContent).toContain("Read the code");
    expect(steps[0].textContent).toContain("Haiku");
    expect(steps[1].textContent).toContain("Planning the change");
    expect(steps[1].textContent).toContain("Opus");
    expect(document.querySelector(".stage")?.textContent).toContain("Planning the change · Opus 5.5");
  });

  it("shows the step a stopped run was on as unfinished", async () => {
    const fake = await startThread();
    fake.emit(running("scout", "scout", HAIKU), done("scout", "scout", HAIKU));
    fake.emit(running("plan", "plan", OPUS));
    fake.emit(result("stopped", 0.01, { reason: "The limit is spent." }));
    fake.exit(0);

    const steps = Array.from(document.querySelectorAll(".st"));
    expect(steps.map((s) => s.className)).toEqual(["st done", "st"]);
    // A finished step gets a check; one the run ended in the middle of gets no mark of its own.
    expect(steps[0].querySelector(".c svg")).toBeTruthy();
    expect(steps[1].querySelector(".c")?.childElementCount).toBe(0);
    expect(steps[1].textContent).toContain("Planning the change");
  });

  it("stops the run when asked", async () => {
    const fake = await startThread();
    fake.emit(running("scout", "scout", HAIKU));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(fake.calls.stops).toBe(1);

    fake.exit(null);
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("idle");
    expect(screen.getByText("You stopped this thread.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    // Nothing was planned yet, so there's no work to change.
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("leaves the cost off the review bar when costs are hidden", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", showCosts: false }));
    const fake = await startThread();
    fake.emit(result("ready", 0.12));
    fake.exit(0);
    expect(document.querySelector(".review .sum")?.textContent).not.toContain("$");
  });

  it("sends requested changes with the plan, within what's left of the limit", async () => {
    const fake = await startThread();
    fake.emit(running("review", "review", HAIKU), done("review", "review", HAIKU, "VERDICT: APPROVE"));
    fake.emit(result("ready", 0.12));
    fake.exit(0);
    expect(screen.getByText(/^Ready to accept\. The checks pass/)).toBeTruthy();
    expect(document.querySelector(".review .sum")?.textContent).toBe("1 check passed · $0.12 in all");

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const notes = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(notes, { target: { value: "Make the badge smaller" } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Enter" });
    });

    expect(fake.calls.starts[1]).toMatchObject({
      task: "Add an annual toggle to the pricing cards",
      changes: { thread: 1, notes: "Make the badge smaller", plan: "1. Add a billing toggle.", branch: "shoji/thread" },
    });
    expect(fake.calls.starts[1].cap).toBeCloseTo(0.38);
    expect(screen.getByText("Make the badge smaller").className).toBe("umsg");
  });

  it("closes the Changes box on Escape without sending", async () => {
    const fake = await startThread();
    fake.emit(running("review", "review", HAIKU), done("review", "review", HAIKU, "VERDICT: APPROVE"));
    fake.emit(result("ready", 0.12));
    fake.exit(0);

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const notes = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(notes, { target: { value: "Make the badge smaller" } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Escape" });
    });

    expect(screen.queryByRole("textbox", { name: "Changes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
    expect(fake.calls.starts.length).toBe(1);
    expect(screen.queryByText("Make the badge smaller")).toBeNull();
  });

  it("accepts the thread's work as one commit on its branch", async () => {
    const fake = await startThread();
    fake.project.diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    fake.emit(running("plan", "plan", OPUS), call("plan", "plan", OPUS, 0.1), done("plan", "plan", OPUS));
    fake.emit(running("build", "build", SONNET), call("build", "build", SONNET, 0.02), done("build", "build", SONNET));
    fake.emit(running("review", "review", HAIKU), done("review", "review", HAIKU, "VERDICT: APPROVE"));
    fake.emit(result("ready", 0.12));
    await act(async () => fake.exit(0));
    expect(document.querySelector(".status .branch")?.textContent).toBe("shoji/thread");

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Accept and commit" }));
    });
    expect(fake.calls.commits).toEqual([
      {
        repo: "/work/pricing-page",
        branch: "shoji/thread",
        message:
          "Add an annual toggle to the pricing cards\n\n" +
          "Shoji-Models: Opus 5.5 plan; Sonnet 5.5 build; Haiku 5.5 review\nShoji-Cost: $0.1200",
        thread: 1,
      },
    ]);
    expect(document.querySelector(".review")?.textContent).toBe(
      "Push and open PRCommitted a1b2c3d on shoji/thread$0.12 in all",
    );
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
    // Nothing is pushed until the person presses the button.
    expect(fake.calls.pushes).toEqual([]);

    fake.project.pushError = "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Push and open PR" }));
    });
    expect(screen.getByText(/terminal prompts disabled/)).toBeTruthy();
    fake.project.pushError = null;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Push and open PR" }));
    });
    expect(fake.calls.pushes).toEqual([
      { repo: "/work/pricing-page", branch: "shoji/thread" },
      { repo: "/work/pricing-page", branch: "shoji/thread" },
    ]);
    expect(screen.getByText("Pushed shoji/thread to origin")).toBeTruthy();
    expect(screen.queryByText(/terminal prompts disabled/)).toBeNull();
  });

  it("says why a commit failed and lets it be tried again", async () => {
    const failing = fakeBridge();
    failing.bridge.commitThread = async () => {
      throw "Git doesn't know who you are yet.";
    };
    const fake = await startThread(failing);
    fake.project.diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    fake.emit(result("ready", 0.01));
    await act(async () => fake.exit(0));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Accept and commit" }));
    });
    expect(screen.getByText("Git doesn't know who you are yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Accept and commit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("pauses after the plan, then builds it or plans again from the person's notes", async () => {
    const fake = await startThread();
    fake.emit(running("plan", "plan", OPUS), done("plan", "plan", OPUS, "1. Add a billing toggle."));
    fake.emit(call("plan", "plan", OPUS, 0.04), result("planned", 0.04));
    fake.exit(0);

    expect(document.querySelector(".stage")?.textContent).toContain("Plan ready");
    expect(screen.getByText(/^Here's the plan\./)).toBeTruthy();
    expect(screen.getByText("The plan").closest("details")?.open).toBe(true);
    expect(screen.queryByRole("button", { name: "Accept and commit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change the plan" }));
    const notes = screen.getByRole("textbox", { name: "Plan changes" });
    fireEvent.change(notes, { target: { value: "Keep the monthly price visible" } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Enter" });
    });
    expect(fake.calls.starts[1]).toMatchObject({
      planOnly: true,
      changes: { kind: "replan", notes: "Keep the monthly price visible", plan: "1. Add a billing toggle." },
    });
    fake.emit(done("plan", "plan", OPUS, "1. Add a toggle. 2. Keep monthly visible."));
    fake.emit(result("planned", 0.04, { plan: "1. Add a toggle. 2. Keep monthly visible." }));
    fake.exit(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Build it" }));
    });
    expect(fake.calls.starts[2]).toMatchObject({
      changes: { kind: "build", plan: "1. Add a toggle. 2. Keep monthly visible." },
    });
    expect(fake.calls.starts[2].planOnly).toBeUndefined();
    expect(screen.getByText("Build it").className).toBe("umsg");
  });

  it("builds straight away when the plan check is off on Home", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    fireEvent.click(await screen.findByRole("button", { name: "Check the plan first" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).planFirst).toBe(false);
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].planOnly).toBeUndefined();
  });

  it("offers to keep going with more when a thread stops at its limit", async () => {
    const fake = await startThread();
    fake.emit(running("plan", "plan", OPUS), done("plan", "plan", OPUS), call("build", "build", SONNET, 0.45));
    fake.emit(result("stopped", 0.45, { reason: "Stopped at $0.45: the next call could pass the $0.50 limit." }));
    fake.exit(1);

    expect(screen.getByText(/^Shoji stopped before the next step could take this thread past its limit/)).toBeTruthy();
    const keep = screen.getByRole("button", { name: "Keep going, up to $0.50 more" });
    expect(keep.className).toBe("btn solid");
    await act(async () => {
      fireEvent.click(keep);
    });

    expect(fake.calls.starts[1]).toMatchObject({ changes: { thread: 1, plan: "1. Add a billing toggle." } });
    expect(fake.calls.starts[1].changes!.notes).toMatch(/^The last run stopped at its spending limit/);
    // Asking for passing checks made the review chase a failure that was there before Shoji started.
    expect(fake.calls.starts[1].changes!.notes).not.toMatch(/checks/);
    // What was left of the first limit, and the same again.
    expect(fake.calls.starts[1].cap).toBeCloseTo(0.55);
    expect(screen.getByText("Keep going").className).toBe("umsg");
  });

  it("offers to fix what the review found, leaving checks that failed before alone", async () => {
    const fake = await startThread();
    const checks = [
      { command: "pnpm test", ok: true, output: "" },
      { command: "pnpm lint", ok: false, output: "2 errors", failedBefore: true },
    ];
    fake.emit(running("build", "build", SONNET), done("build", "build", SONNET), {
      type: "checks",
      step: "build",
      results: checks,
    });
    fake.emit(
      running("review", "review", HAIKU),
      done("review", "review", HAIKU, "VERDICT: REVISE\n1. Fix the import."),
    );
    fake.emit(
      result("needs-work", 0.36, {
        review: "VERDICT: REVISE\n1. Fix the import.",
        failingBefore: ["pnpm lint"],
        failingTestsBefore: ["src/a.ts TS2322"],
        checks,
      }),
    );
    fake.exit(1);

    expect(document.querySelector(".review .sum")?.textContent).toContain("1 check passed, 1 failing as before");
    expect(screen.getByText(/^The review found problems/)).toBeTruthy();
    expect(screen.getByText("· failed before the change too")).toBeTruthy();
    const fix = screen.getByRole("button", { name: "Fix it, up to $0.50 more" });
    expect(fix.className).toBe("btn solid");
    await act(async () => {
      fireEvent.click(fix);
    });

    const changes = fake.calls.starts[1].changes!;
    expect(changes.notes).toMatch(/^The last run ended with work left to do\./);
    expect(changes.notes).not.toMatch(/checks passing/);
    expect(changes.notes).toContain("The review said:\n1. Fix the import.");
    expect(changes.failingBefore).toEqual(["pnpm lint"]);
    expect(changes.failingTestsBefore).toEqual(["src/a.ts TS2322"]);
    expect(fake.calls.starts[1].cap).toBeCloseTo(0.64);
    expect(screen.getByText("Fix what the review found").className).toBe("umsg");
  });

  it("counts a check with new failures as failed, though it was failing before", async () => {
    const fake = await startThread();
    const checks = [{ command: "pnpm test", ok: false, output: " FAIL  b.test.ts", newFailures: ["FAIL b.test.ts"] }];
    fake.emit(running("build", "build", SONNET), done("build", "build", SONNET), {
      type: "checks",
      step: "build",
      results: checks,
    });
    fake.emit(result("needs-work", 0.2, { failingBefore: ["pnpm test"], checks }));
    fake.exit(1);

    expect(screen.getAllByText("1 of 1 check failed").length).toBeGreaterThan(0);
    expect(screen.getByText("· failed before the change too, with 1 new failure")).toBeTruthy();
  });

  it("asks before an MCP tool that could change something", async () => {
    const fake = await startThread();
    fake.emit(running("build", "build", SONNET), {
      type: "ask",
      step: "build",
      command: "github: create_issue",
      tool: true,
    });
    const ask = screen.getByRole("alertdialog", { name: "Allow this tool?" });
    expect(ask.textContent).toContain("Build wants to use github: create_issue from an MCP server.");
    fake.emit({ type: "answer", step: "build", command: "github: create_issue", allowed: true });
    fake.emit({ type: "tool", step: "build", tool: "mcp__github__create_issue", target: "github: create_issue" });
    fake.emit({ type: "mcp", server: "postgres", error: "spawn psql-mcp ENOENT" });
    expect(screen.getByText("Used github: create_issue")).toBeTruthy();
    expect(
      screen.getByText("Couldn't reach the postgres MCP server, so this run went on without it. spawn psql-mcp ENOENT"),
    ).toBeTruthy();
  });

  it("says which skills a role read", async () => {
    const fake = await startThread();
    fake.emit(
      running("build", "build", SONNET),
      { type: "tool", step: "build", tool: "read_skill", target: "migrations" },
      { type: "tool", step: "build", tool: "read_skill", target: "migrations" },
      { type: "tool", step: "build", tool: "read_skill", target: "release-notes" },
    );
    expect(screen.getByText("Used the migrations skill and 1 more")).toBeTruthy();
  });

  it("says which pages Build looked at", async () => {
    const fake = await startThread();
    fake.emit(running("build", "build", SONNET), {
      type: "tool",
      step: "build",
      tool: "look_at_page",
      target: "/pricing at 360px",
    });
    expect(screen.getByText("Looked at /pricing at 360px")).toBeTruthy();
  });

  it("waits for the person before a command beyond the checks, and remembers one always allowed", async () => {
    const fake = await startThread();
    fake.emit(running("build", "build", SONNET), { type: "ask", step: "build", command: "npm install" });

    expect(document.querySelector(".stage")?.textContent).toContain("Waiting for you");
    const ask = screen.getByRole("alertdialog", { name: "Allow this command?" });
    expect(ask.textContent).toContain("Build wants to run npm install.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Always allow in pricing-page" }));
    });
    expect(fake.calls.answers).toEqual([true]);
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands).toEqual({
      "/work/pricing-page": ["npm install"],
    });

    fake.emit({ type: "answer", step: "build", command: "npm install", allowed: true });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fake.emit(done("build", "build", SONNET), result("stopped", 0.5, { plan: "1. Add it." }));
    fake.exit(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Keep going/ }));
    });
    expect(fake.calls.starts[1].allowedCommands).toEqual(["npm install"]);
  });

  it("tells the run when the person turns a command down", async () => {
    const fake = await startThread();
    fake.emit(running("build", "build", SONNET), { type: "ask", step: "build", command: "curl example.com" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Don't allow" }));
    });
    expect(fake.calls.answers).toEqual([false]);
    fake.emit({ type: "answer", step: "build", command: "curl example.com", allowed: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands ?? {}).toEqual({});
  });

  it("draws the plan's markdown as text, not as marks", async () => {
    const fake = await startThread();
    fake.emit(
      running("plan", "plan", OPUS),
      done("plan", "plan", OPUS, "## Steps\n1. Add **the toggle** in `Card.tsx`\n   - keep it small\n2. Test it"),
    );
    fake.emit(result("planned", 0.04));
    fake.exit(0);

    const plan = screen.getByText("The plan").closest("details")!;
    expect(plan.querySelector("h3")?.textContent).toBe("Steps");
    expect(plan.textContent).not.toContain("#");
    expect(plan.querySelectorAll("ol > li")).toHaveLength(2);
    expect(plan.querySelector("ol li ul li")?.textContent).toBe("keep it small");
    expect(plan.querySelector("strong")?.textContent).toBe("the toggle");
    expect(plan.querySelector("code")?.textContent).toBe("Card.tsx");
  });

  it("says why the work needs more, in the runtime's words", async () => {
    const fake = await startThread();
    fake.emit(
      result("needs-work", 0.1, { reason: "Shoji couldn't run npm run lint: its program isn't on this computer." }),
    );
    fake.exit(1);
    expect(screen.getByText(/^Shoji couldn't run npm run lint/)).toBeTruthy();
  });

  it("offers to start again when the thread couldn't start", async () => {
    const fake = fakeBridge();
    let fail = true;
    const startRun = fake.bridge.startRun;
    fake.bridge.startRun = async (request) => {
      if (fail) throw new Error("The project has uncommitted changes.");
      return startRun(request);
    };
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(screen.getByText(/uncommitted changes/)).toBeTruthy();

    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a FAQ"]);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows why the runtime couldn't start", async () => {
    const fake = await startThread();
    fake.exit(2, "The project has uncommitted changes. Commit or stash them, or pass --allow-dirty.");
    expect(screen.getByText(/^The project has uncommitted changes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });
});

describe("home", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("checks the folder before starting, and keeps the task until it's sorted out", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", setupDone: true }));
    const fake = fakeBridge();
    fake.project.git = false;
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "pricing-page isn't a git repository. Shoji works in git so every change can be reviewed and undone.",
    );
    expect(fake.calls.starts).toEqual([]);
    expect((task as HTMLTextAreaElement).value).toBe("Add a FAQ");

    // Changes the person hasn't committed don't hold a thread up: it works in its own copy.
    fake.project.git = true;
    fake.project.diff = "diff --git a/x b/x";
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a FAQ"]);
  });

  it("asks for a key before anything can run", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true }));
    render(<App bridge={fakeBridge({ saved: false, fromEnv: false }).bridge} />);
    expect(await screen.findByText("Add it in Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("settings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("lets the limit be typed a character at a time and keeps only a positive amount", async () => {
    render(<App bridge={fakeBridge().bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const limit = screen.getByRole("spinbutton", { name: /Limit per thread/ }) as HTMLInputElement;
    for (const typed of ["", "0", "0.0", "0.03"]) fireEvent.change(limit, { target: { value: typed } });
    expect(limit.value).toBe("0.03");
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).cap).toBe(0.03);
  });
});
