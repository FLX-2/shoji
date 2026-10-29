import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerCall, LedgerRun, LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { firstTry, monthOf, oneModelCost, outcome, priceAs, receipt, summarize, toCsv } from "./receipts";

const OCT = new Date(2026, 9, 20, 14, 5).getTime();
const SEP = new Date(2026, 8, 12, 9, 30).getTime();

function call(step: string, role: string, model: string, tokens: Partial<LedgerCall> = {}): LedgerCall {
  const c = {
    at: OCT,
    step,
    role,
    model,
    effort: "medium",
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    seconds: 1,
    ...tokens,
  } as LedgerCall;
  return {
    ...c,
    cost:
      c.model in { "claude-opus-5-5": 1, "claude-sonnet-5-5": 1, "claude-haiku-5-5": 1 }
        ? priceAs(c.model as never, c)
        : 0.01,
  };
}

function run(kind: LedgerRun["kind"], status: LedgerRun["status"], calls: LedgerCall[]): LedgerRun {
  return { id: Math.random(), kind, startedAt: OCT, status, calls };
}

function thread(id: number, task: string, runs: LedgerRun[], extra: Partial<LedgerThread> = {}): LedgerThread {
  return {
    id,
    task,
    repo: "/work/pricing-page",
    branch: `shoji/t${id}`,
    stack: "balanced",
    startedAt: OCT,
    committed: null,
    committedAt: null,
    runs,
    ...extra,
  };
}

const routed = () => [
  call("scout", "scout", "claude-haiku-5-5"),
  call("plan", "plan", "claude-opus-5-5"),
  call("build", "build", "claude-sonnet-5-5"),
  call("build", "build", "claude-sonnet-5-5"),
  call("review", "review", "claude-haiku-5-5"),
];

describe("receipts", () => {
  it("prices the same tokens on another model", () => {
    const c = call("plan", "plan", "claude-haiku-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // Opus: $4 in, $20 out, $5 to write the cache, $0.20 to read it.
    expect(priceAs("claude-opus-5-5", c)).toBeCloseTo(29.2);
  });

  it("estimates a routed thread against its stack's Plan model", () => {
    const t = thread(1, "Add a toggle", [run("task", "ready", routed())]);
    // Five calls of 1,000 in and 500 out on Opus: 5 × ($0.004 + $0.01).
    expect(oneModelCost(t)).toBeCloseTo(0.07);
    expect(oneModelCost({ ...t, stack: "haiku" })).toBeCloseTo(5 * (0.0001 + 0.00025));
  });

  it("sums a month: spend, the saving, cost per accepted task and first-try accept", () => {
    const threads = [
      thread(1, "First try", [run("task", "ready", routed())], { committed: "a1" }),
      thread(2, "After changes", [run("task", "ready", routed()), run("changes", "ready", routed())], {
        committed: "b2",
      }),
      thread(3, "Abandoned", [run("task", "needs-work", routed())]),
      thread(4, "Last month", [run("task", "ready", routed())], { startedAt: SEP, committed: "c3" }),
    ];
    const s = summarize(threads, monthOf(OCT));
    const spentPerRun = routed().reduce((sum, c) => sum + c.cost, 0);
    expect(s.threads.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(s.spent).toBeCloseTo(4 * spentPerRun);
    expect(s.saved).toBeCloseTo(4 * (0.07 - spentPerRun));
    expect(s.perAccepted).toBeCloseTo((4 * spentPerRun) / 2);
    expect(s.firstTry).toBeCloseTo(1 / 3);
    expect(firstTry(threads[1])).toBe(false);
  });

  it("writes a receipt line per step and model, in order", () => {
    const t = thread(1, "Add a toggle", [
      run("task", "ready", routed()),
      run("changes", "ready", [call("changes", "build", "claude-sonnet-5-5")]),
    ]);
    const r = receipt(t);
    expect(r.lines.map((l) => [l.step, l.model])).toEqual([
      ["scout", "claude-haiku-5-5"],
      ["plan", "claude-opus-5-5"],
      ["build", "claude-sonnet-5-5"],
      ["review", "claude-haiku-5-5"],
      ["changes", "claude-sonnet-5-5"],
    ]);
    expect(r.lines[2].cost).toBeCloseTo(2 * 0.007);
    expect(r.tokensIn).toBe(6000);
    expect(r.tokensOut).toBe(3000);
  });

  it("names how a thread ended", () => {
    expect(outcome(thread(1, "t", [run("task", "ready", [])], { committed: "a1" }))).toBe("Accepted");
    expect(outcome(thread(1, "t", [run("task", "ready", [])]))).toBe("Not accepted");
    expect(outcome(thread(1, "t", [run("task", "stopped", [])]))).toBe("Stopped");
    expect(outcome(thread(1, "t", [run("task", null, [])]))).toBe("Running");
  });

  it("exports one CSV row per thread, quoting what needs it", () => {
    const csv = toCsv([thread(1, 'Say "hi", then\nwave', [run("task", "ready", routed())], { committed: "a1" })]);
    const [header, row] = csv.trimEnd().split("\n");
    expect(header).toBe(
      "started,task,project,branch,stack,outcome,commit,requests for changes,cost,one-model estimate,one model",
    );
    expect(row).toContain('"Say ""hi"", then"');
    expect(row).toContain(",Accepted,a1,0,");
    expect(row.endsWith(",0.0700,Opus 5.5")).toBe(true);
  });
});

describe("the Receipts view", () => {
  afterEach(cleanup);

  async function openReceipts(threads: LedgerThread[]) {
    const fake = fakeBridge();
    fake.ledger.push(...threads);
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Receipts" }));
    });
    return fake;
  }

  it("shows the month's figures and a receipt for the chosen thread", async () => {
    await openReceipts([
      thread(2, "Escape closes the box", [run("task", "ready", routed())], { committed: "b2c3d4e" }),
      thread(1, "Add formatCost tests", [run("task", "stopped", [call("scout", "scout", "claude-haiku-5-5")])]),
    ]);
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(screen.getByText("Saved against one model")).toBeTruthy();
    expect(screen.getByText("An estimate, if every step ran on Opus 5.5")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();

    const pane = screen.getByRole("complementary", { name: "Receipt" });
    expect(within(pane).getByText("Escape closes the box")).toBeTruthy();
    expect(within(pane).getByText(/Accepted as b2c3d4e/)).toBeTruthy();

    fireEvent.click(screen.getByRole("row", { name: /Add formatCost tests/ }));
    expect(within(pane).getByText("Add formatCost tests")).toBeTruthy();
    expect(within(pane).getByText("Stopped")).toBeTruthy();
  });

  it("steps between months that have threads", async () => {
    await openReceipts([
      thread(2, "This month", [run("task", "ready", routed())]),
      thread(1, "Last month", [run("task", "ready", routed())], { startedAt: SEP }),
    ]);
    expect(screen.getByRole("button", { name: "Later month" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Earlier month" }));
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(screen.getByRole("row", { name: /Last month/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /This month/ })).toBeNull();
  });

  it("exports the month as CSV", async () => {
    const fake = await openReceipts([thread(1, "Add a toggle", [run("task", "ready", routed())])]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    });
    expect(fake.calls.exports[0].name).toBe("shoji-receipts-2026-10.csv");
    expect(fake.calls.exports[0].contents).toContain("Add a toggle");
    expect(screen.getByText("Saved shoji-receipts-2026-10.csv")).toBeTruthy();
  });

  it("says what Receipts will hold before any thread has run", async () => {
    await openReceipts([]);
    expect(screen.getByText("No receipts yet")).toBeTruthy();
  });
});
