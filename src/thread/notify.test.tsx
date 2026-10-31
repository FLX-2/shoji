import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const HAIKU = "claude-haiku-5-5";

const ready: RuntimeEvent = {
  type: "result",
  result: {
    status: "ready",
    plan: "1. Add faq.html.",
    diff: "",
    review: "",
    checks: [],
    escalated: false,
    cost: 0.01,
    costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
  },
};

const record = (id: number, task: string, status: LedgerThread["runs"][number]["status"]): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: `shoji/thread-${id}`,
  workdir: `/data/worktrees/thread-${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 1000,
  committed: null,
  committedAt: null,
  runs: [{ id: id * 10, kind: "task", startedAt: Date.now(), status, calls: [] }],
});

const go = async (section: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: section }));
  });

const list = () => screen.getByRole("navigation", { name: "Threads" });

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
  fake.ledger.unshift(record(1, task, null));
  return fake;
}

describe("telling the person a thread needs them", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("notifies when a thread asks to run a command, and when it ends, while the person is elsewhere", async () => {
    const fake = await startTask("Add a FAQ");
    await act(async () => {
      fake.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    await go("Receipts");
    await act(async () => {
      fake.emit({ type: "ask", step: "build", command: "pnpm add marked" });
    });
    expect(fake.calls.notified).toEqual([
      { title: "Add a FAQ", body: "Wants to run pnpm add marked. Open Shoji to allow it or not." },
    ]);
    expect(fake.calls.waiting.at(-1)).toBe(1);

    await act(async () => {
      fake.emit({ type: "answer", step: "build", command: "pnpm add marked", allowed: true }, ready);
      fake.exit(0);
    });
    expect(fake.calls.notified[1]).toEqual({
      title: "Add a FAQ",
      body: "Ready to accept. The review approved the change.",
    });
  });

  it("stays quiet about the thread the person is watching, and when switched off", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const fake = await startTask("Add a FAQ");
    await act(async () => {
      fake.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    await act(async () => {
      fake.emit(ready);
      fake.exit(0);
    });
    expect(fake.calls.notified).toEqual([]);

    cleanup();
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({ repo: "/work/pricing-page", planFirst: false, notify: false }),
    );
    const quiet = await startTask("Fix the footer");
    await act(async () => {
      quiet.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    await go("Receipts");
    await act(async () => {
      quiet.emit(ready);
      quiet.exit(0);
    });
    expect(quiet.calls.notified).toEqual([]);
  });

  it("marks a thread that moved on since the person last looked, and counts it on the icon", async () => {
    const fake = fakeBridge();
    fake.ledger.push(record(1, "Fix the footer", "needs-work"), record(2, "Add a FAQ", null));
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await go("Threads");
    // What was there at the first look isn't news.
    expect(within(list()).queryByRole("img", { name: "Unread" })).toBeNull();

    fake.ledger[1].runs[0].status = "ready";
    await go("Receipts");
    await go("Threads");
    const row = within(list()).getByRole("button", { name: /^Add a FAQ/ });
    expect(within(row).getByRole("img", { name: "Unread" })).toBeTruthy();
    expect(fake.calls.waiting.at(-1)).toBe(1);

    await act(async () => {
      fireEvent.click(row);
    });
    expect(within(list()).queryByRole("img", { name: "Unread" })).toBeNull();
    expect(fake.calls.waiting.at(-1)).toBe(0);
    // And it stays read once the person moves on.
    await go("Receipts");
    await go("Threads");
    expect(within(list()).queryByRole("img", { name: "Unread" })).toBeNull();
  });
});
