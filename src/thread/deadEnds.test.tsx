import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const HAIKU = "claude-haiku-5-5";

const result = (status: ThreadResult["status"], plan: string, extra: Partial<ThreadResult> = {}): RuntimeEvent => ({
  type: "result",
  result: {
    status,
    plan,
    diff: "",
    review: "",
    checks: [],
    escalated: false,
    cost: 0.01,
    costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
    ...extra,
  },
});

const record = (id: number, task: string): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: "shoji/thread",
  workdir: "/data/worktrees/thread",
  stack: "balanced",
  startedAt: Date.now(),
  committed: null,
  committedAt: null,
  runs: [{ id, kind: "task", startedAt: Date.now(), status: null, calls: [] }],
});

async function startTask(task: string) {
  const fake = fakeBridge();
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  const box = await screen.findByRole("textbox", { name: "Task" });
  fireEvent.change(box, { target: { value: task } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
  fake.ledger.unshift(record(1, task));
  return fake;
}

const click = async (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("a thread that ended early", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("starts again when it failed before its plan, clearing the empty first try away", async () => {
    const fake = await startTask("Add a FAQ");
    fake.emit(
      { type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" },
      result("failed", "", { reason: "The API is overloaded." }),
    );
    fake.exit(0);
    expect(screen.queryByRole("textbox", { name: "Changes" })).toBeNull();

    await click("Try again");
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a FAQ", "Add a FAQ"]);
    expect(fake.calls.discarded).toEqual([1]);
  });

  it("brings the task back to Home to edit", async () => {
    const fake = await startTask("Add a FAQ page with five questions");
    fake.emit(result("failed", "", { reason: "Boom" }));
    fake.exit(0);
    await click("Edit the task");
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe(
      "Add a FAQ page with five questions",
    );
    expect(fake.calls.starts).toHaveLength(1);
  });

  it("picks the work up where a run broke off after its plan", async () => {
    const fake = await startTask("Add a FAQ");
    fake.emit(result("failed", "1. Add faq.html.", { reason: "The connection dropped." }));
    fake.exit(0);
    await click("Pick up where it stopped");
    expect(fake.calls.starts).toHaveLength(2);
    expect(fake.calls.starts[1]).toMatchObject({
      ask: "Pick up where it stopped",
      changes: { thread: 1, plan: "1. Add faq.html.", branch: "shoji/thread" },
    });
    expect(fake.calls.starts[1].changes?.notes).toMatch(/stopped before it finished/);
  });

  it("carries committed work on in a new thread from its branch", async () => {
    const fake = await startTask("Add a FAQ");
    fake.project.diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    fake.emit(result("ready", "1. Add faq.html."));
    await act(async () => fake.exit(0));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Accept and commit" }));
    });
    await click("Carry on in a new thread");
    expect(screen.getByRole("button", { name: /Carries on “Add a FAQ”/ })).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Style the FAQ" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[1]).toMatchObject({ task: "Style the FAQ", from: "shoji/thread" });
  });
});
