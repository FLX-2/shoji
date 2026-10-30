import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import App from "../App";
import type { LedgerCall, LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const SONNET = "claude-sonnet-5-5";
const DAY = 24 * 60 * 60 * 1000;

const call = (cost: number): LedgerCall => ({
  at: 0,
  role: "build",
  step: "build",
  model: SONNET,
  effort: "medium",
  inputTokens: 1,
  outputTokens: 1,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  cost,
  seconds: 1,
});

const finished = (status: ThreadResult["status"], review: string): RuntimeEvent[] => [
  { type: "step", step: "build", role: "build", model: SONNET, status: "running" },
  { type: "step", step: "build", role: "build", model: SONNET, status: "done", output: "Changed the footer." },
  {
    type: "result",
    result: {
      status,
      plan: "1. Fix the footer.",
      diff: "",
      review,
      checks: [],
      escalated: false,
      cost: 0.02,
      costByRole: { scout: 0, plan: 0, build: 0.02, review: 0 },
    },
  },
];

function ledger(now: number): LedgerThread[] {
  return [
    {
      id: 3,
      task: "Try Haiku for building",
      repo: "/work/pricing-page",
      branch: "",
      stack: "haiku",
      startedAt: now - 1000,
      committed: null,
      committedAt: null,
      runs: [{ id: 30, kind: "trial", startedAt: now - 1000, status: "ready", calls: [] }],
    },
    {
      id: 2,
      task: "Fix the footer",
      repo: "/work/pricing-page",
      branch: "shoji/fix-the-footer",
      stack: "balanced",
      startedAt: now - 2000,
      committed: null,
      committedAt: null,
      runs: [{ id: 20, kind: "task", startedAt: now - 2000, status: "needs-work", ask: null, calls: [call(0.02)] }],
    },
    {
      id: 1,
      task: "Add a FAQ",
      repo: "/work/pricing-page",
      branch: "shoji/add-a-faq",
      stack: "balanced",
      startedAt: now - 2 * DAY,
      committed: "abc1234",
      committedAt: now - 2 * DAY,
      runs: [
        { id: 10, kind: "task", startedAt: now - 2 * DAY, status: "ready", calls: [call(0.03)] },
        { id: 11, kind: "changes", startedAt: now - 2 * DAY, status: "ready", ask: "Make it blue", calls: [] },
      ],
    },
  ];
}

describe("the thread list", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function openThreads() {
    const fake = fakeBridge();
    fake.ledger.push(...ledger(Date.now()));
    fake.logs[10] = finished("ready", "VERDICT: APPROVE");
    fake.logs[11] = finished("ready", "VERDICT: APPROVE");
    fake.logs[20] = finished("needs-work", "VERDICT: FIX\n1. The footer still overlaps.");
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    return fake;
  }

  it("lists the person's threads, newest first, without trials", async () => {
    await openThreads();
    const list = screen.getByRole("navigation", { name: "Threads" });
    const rows = within(list)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^Fix the footerNeeds work\$0\.020\d\d:\d\d$/);
    expect(rows[1]).toMatch(/^Add a FAQCommitted\$0\.030\d+ \w{3}$/);
    expect(screen.getByRole("heading", { name: "Pick a thread" })).toBeTruthy();
  });

  it("reopens a thread from its logs, with what the person asked, and carries it on", async () => {
    const fake = await openThreads();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add a FAQ/ }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
    expect(screen.getByText("Make it blue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Add a FAQ/ }).getAttribute("aria-current")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Fix the footer/ }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const notes = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(notes, { target: { value: "Move it below the fold" } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Enter" });
    });
    expect(fake.calls.starts).toHaveLength(1);
    expect(fake.calls.starts[0]).toMatchObject({
      task: "Fix the footer",
      ask: "Move it below the fold",
      cap: 0.48,
      changes: {
        thread: 2,
        branch: "shoji/fix-the-footer",
        plan: "1. Fix the footer.",
        notes: "Move it below the fold",
      },
    });
  });
});
