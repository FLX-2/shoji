import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CallRecord, RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import type { ModelId } from "../../runtime/src/models";
import type { Role } from "../../runtime/src/stack";
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

  async function startThread() {
    const fake = fakeBridge();
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
    expect(fake.calls.starts).toEqual([
      { repo: "/work/pricing-page", task: "Add an annual toggle to the pricing cards", stack: "balanced", cap: 0.5 },
    ]);

    fake.emit(running("scout", "scout", HAIKU), call("scout", "scout", HAIKU, 0.001), done("scout", "scout", HAIKU));
    fake.emit(running("plan", "plan", OPUS));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add an annual toggle to the pricing cards");
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("running");
    const steps = Array.from(document.querySelectorAll(".st"));
    expect(steps.map((s) => s.className)).toEqual(["st done", "st now"]);
    expect(steps[0].textContent).toContain("Read the code");
    expect(steps[0].textContent).toContain("haiku");
    expect(steps[1].textContent).toContain("Planning the change");
    expect(steps[1].textContent).toContain("opus");
    expect(steps[1].querySelector(".ho")).toBeTruthy();
    expect(screen.getByText("Planning the change · Opus 5.5")).toBeTruthy();
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

  it("sends requested changes with the plan, within what's left of the limit", async () => {
    const fake = await startThread();
    fake.emit(running("review", "review", HAIKU), done("review", "review", HAIKU, "VERDICT: APPROVE"));
    fake.emit(result("ready", 0.12));
    fake.exit(0);
    expect(screen.getByText(/^Ready for review\. The checks pass/)).toBeTruthy();
    expect(document.querySelector(".review .sum")?.textContent).toBe("1 check passed · $0.12 in all");

    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const notes = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(notes, { target: { value: "Make the badge smaller" } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Enter" });
    });

    expect(fake.calls.starts[1]).toMatchObject({
      task: "Add an annual toggle to the pricing cards",
      changes: { notes: "Make the badge smaller", plan: "1. Add a billing toggle.", branch: "shoji/thread" },
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
    expect(document.querySelector(".status .r")?.textContent).toBe("shoji/thread");

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
      },
    ]);
    expect(document.querySelector(".review")?.textContent).toBe("Committed a1b2c3d on shoji/thread$0.12 in all");
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("says why a commit failed and lets it be tried again", async () => {
    const fake = await startThread();
    fake.project.diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    fake.bridge.commitThread = async () => {
      throw "Git doesn't know who you are yet.";
    };
    fake.emit(result("ready", 0.01));
    await act(async () => fake.exit(0));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Accept and commit" }));
    });
    expect(screen.getByText("Git doesn't know who you are yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Accept and commit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows why the runtime couldn't start", async () => {
    const fake = await startThread();
    fake.exit(2, "The project has uncommitted changes. Commit or stash them, or pass --allow-dirty.");
    expect(screen.getByText(/^The project has uncommitted changes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });
});

describe("home", () => {
  afterEach(cleanup);

  it("asks for a key before anything can run", async () => {
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
