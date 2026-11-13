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

const finished = (status: ThreadResult["status"], review: string, cost = 0.02): RuntimeEvent[] => [
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
      cost,
      costByRole: { scout: 0, plan: 0, build: cost, review: 0 },
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

const send = async (text: string) => {
  const task = await screen.findByRole("textbox", { name: "Task" });
  fireEvent.change(task, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(task, { key: "Enter" });
  });
};

const started = (id: number, task: string): LedgerThread => ({
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
    // Earlier this week shows the weekday.
    expect(rows[1]).toMatch(/^Add a FAQCommitted\$0\.030(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    // With nothing on show, the pane beside the list takes a new task.
    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
  });

  it("groups threads by what they need, and counts a run Shoji closed during as stopped", async () => {
    const fake = fakeBridge();
    const now = Date.now();
    // Ids clear of the one the new thread gets.
    const [trial, footer, faq] = ledger(now).map((t) => ({ ...t, id: t.id + 10 }));
    fake.ledger.push(
      trial,
      footer,
      {
        id: 14,
        task: "Tidy the header",
        repo: "/work/pricing-page",
        branch: "shoji/tidy-the-header",
        stack: "balanced",
        startedAt: now - 3000,
        committed: null,
        committedAt: null,
        runs: [{ id: 40, kind: "task", startedAt: now - 3000, status: null, calls: [] }],
      },
      faq,
    );
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    const list = screen.getByRole("navigation", { name: "Threads" });
    const group = (name: string) =>
      within(within(screen.getByRole("navigation", { name: "Threads" })).getByRole("region", { name }))
        .getAllByRole("listitem")
        .map((row) => row.querySelector("b")!.textContent);
    expect(within(list).queryByRole("region", { name: "Running" })).toBeNull();
    expect(group("Needs you")).toEqual(["Fix the footer"]);
    expect(group("Earlier")).toEqual(["Tidy the header", "Add a FAQ"]);
    expect(within(list).getByText("Stopped")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: "New task" }));
    });
    await send("Fix the nav");
    fake.ledger.unshift(started(1, "Fix the nav"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    expect(group("Running")).toEqual(["Fix the nav"]);
  });

  it("reopens a thread from its logs, with what the person asked, and carries it on", async () => {
    const fake = await openThreads();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add a FAQ/ }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
    expect(screen.getByText("Make it blue")).toBeTruthy();
    const list = screen.getByRole("navigation", { name: "Threads" });
    expect(within(list).getByRole("button", { name: /^Add a FAQ/ }).getAttribute("aria-current")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Fix the footer/ }));
    });
    fireEvent.click(screen.getByRole("radio", { name: "Request changes" }));
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

  /** A thread that was given more once, so it has spent more than the limit new threads get. */
  async function openGivenMore(runs: LedgerThread["runs"], prefs: object = {}) {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", cap: 0.5, ...prefs }));
    const fake = fakeBridge();
    fake.ledger.push({ ...ledger(Date.now())[1], runs });
    fake.logs[20] = finished("stopped", "", 0.45);
    fake.logs[21] = finished("ready", "VERDICT: APPROVE", 0.25);
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Fix the footer/ }));
    });
    return fake;
  }
  const given = (caps: [number, number] | []): LedgerThread["runs"] => [
    { id: 20, kind: "task", startedAt: 0, status: "stopped", calls: [call(0.45)], ...(caps.length && { cap: caps[0] }) },
    {
      id: 21,
      kind: "changes",
      startedAt: 1,
      status: "ready",
      ask: "Keep going",
      calls: [call(0.25)],
      ...(caps.length && { cap: caps[1] }),
    },
  ];
  const write = async (text: string) => {
    const notes = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(notes, { target: { value: text } });
    await act(async () => {
      fireEvent.keyDown(notes, { key: "Enter" });
    });
    return notes as HTMLTextAreaElement;
  };

  it("reopens a thread with the limit it was given, so what's left of it can still be spent", async () => {
    // Started with $0.50 and stopped at $0.45; Keep going raised the limit to $1, and $0.70 is spent.
    const fake = await openGivenMore(given([0.5, 0.55]));
    expect(screen.queryByText(/limit is spent/)).toBeNull();
    expect(screen.queryByText(/more$/)).toBeNull();
    await write("Move it below the fold");
    expect(fake.calls.starts).toHaveLength(1);
    expect(fake.calls.starts[0].cap).toBeCloseTo(0.3);
  });

  it("lets a thread that has spent its limit carry on, with as much more as Keep going gives", async () => {
    // From before the limit was kept: it reads as what the thread has spent.
    const fake = await openGivenMore(given([]));
    expect(screen.getByText(/the \$0\.70 limit is spent/)).toBeTruthy();
    expect(screen.getByText("Up to $0.50 more")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send, up to $0.50 more" })).toBeTruthy();
    const notes = await write("Move it below the fold");
    expect(fake.calls.starts).toHaveLength(1);
    expect(fake.calls.starts[0]).toMatchObject({ ask: "Move it below the fold", changes: { thread: 2 } });
    expect(fake.calls.starts[0].cap).toBeCloseTo(0.5);
    expect(notes.value).toBe("");
  });

  it("asks before a spent thread's next run could take the day past its limit, and keeps what was written", async () => {
    const fake = await openGivenMore(given([]), { dailyLimit: 0.4 });
    fireEvent.click(screen.getByRole("radio", { name: "Ask a question" }));
    const box = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Why did the footer move?" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    const ask = screen.getByRole("alertdialog");
    expect(ask.textContent).toContain("Carrying this thread on may spend up to $0.50");
    expect(fake.calls.starts).toHaveLength(0);
    expect(box.value).toBe("Why did the footer move?");
    await act(async () => {
      fireEvent.click(within(ask).getByRole("button", { name: "Start anyway" }));
    });
    expect(fake.calls.starts).toHaveLength(1);
    expect(fake.calls.starts[0]).toMatchObject({ changes: { thread: 2, kind: "question" } });
    expect(fake.calls.starts[0].cap).toBeCloseTo(0.5);
  });

  it("runs threads side by side, each in its own copy, and stops only the one on show", async () => {
    const fake = fakeBridge();
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });

    await send("Add a FAQ");
    fake.ledger.unshift(started(1, "Add a FAQ"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    // Home takes a second task while the first runs.
    await send("Fix the footer");
    fake.ledger.unshift(started(2, "Fix the footer"));
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a FAQ", "Fix the footer"]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix the footer");
    expect(screen.getByText("2 threads running")).toBeTruthy();

    // The first thread's run finishes out of sight, and only the one on show is stopped.
    fake.emitTo(1, ...finished("ready", "VERDICT: APPROVE"));
    fake.exitOf(1);
    expect(screen.queryByText("2 threads running")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(fake.calls.stoppedRuns).toEqual([2]);

    // The first thread is still held, finished, so it opens without reading its log back.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add a FAQ/ }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
    expect(screen.getByText("Changed the footer.")).toBeTruthy();
  });

  it("opens a thread whose steps were cleared with how it ended and what it cost, from the ledger", async () => {
    const fake = fakeBridge();
    fake.ledger.push(...ledger(Date.now()));
    // The committed thread's logs are gone.
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    const list = screen.getByRole("navigation", { name: "Threads" });
    await act(async () => {
      fireEvent.click(within(list).getByText("Add a FAQ"));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
    expect(screen.getAllByText("This run's steps were cleared with old data. Receipts still have what it cost.")).toHaveLength(2);
    // Not a failure, and the cost is the ledger's.
    expect(screen.queryByText("Failed")).toBeNull();
    expect(within(screen.getByRole("main")).getAllByText("$0.030").length).toBeGreaterThan(0);
    expect(screen.getByText("abc1234")).toBeTruthy();
  });
});
