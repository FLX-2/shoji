import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import type { LedgerCall, LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { watch } from "./watch";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 30, 12).getTime();

function call(role: LedgerCall["role"], model: string, seconds: number, cost: number, at: number): LedgerCall {
  return {
    at,
    step: role,
    role,
    model,
    effort: "medium",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    cost,
    seconds,
  };
}

let ids = 0;
/** A thread `daysAgo` that planned on Opus and built on Sonnet, accepted on the first try unless `changes`. */
function task(
  daysAgo: number,
  { planSeconds = 20, buildCost = 0.1, changes = false, kind = "task" as "task" | "trial", now = NOW } = {},
): LedgerThread {
  const at = now - daysAgo * DAY;
  const id = ++ids;
  const calls = [
    call("plan", "claude-opus-5-5", planSeconds, 0.05, at),
    call("build", "claude-sonnet-5-5", 30, buildCost, at + 1000),
  ];
  return {
    id,
    task: "Earlier work",
    repo: "/work/pricing-page",
    branch: "shoji/x",
    stack: "balanced",
    startedAt: at,
    committed: "abc1234",
    committedAt: at + 5000,
    runs: [
      { id, kind, startedAt: at, status: "ready", calls },
      ...(changes
        ? [
            {
              id: id + 0.5,
              kind: "changes" as const,
              startedAt: at + 2000,
              status: "ready" as const,
              calls: [],
            },
          ]
        : []),
    ],
  };
}

const weeks = (n: number, days: number[], options = {}) => days.slice(0, n).map((d) => task(d, options));
const BEFORE_DAYS = [9, 12, 15, 18, 21, 24];
const RECENT_DAYS = [1, 2, 3, 4, 5, 6];

describe("watching the stack for regressions", () => {
  it("names a model whose steps got slower this week, and says what didn't change", () => {
    const ledger = [...weeks(6, BEFORE_DAYS), ...weeks(6, RECENT_DAYS, { planSeconds: 28 })];
    const { compared, regressions } = watch(ledger, STACKS.balanced, NOW);
    expect(compared).toBe(true);
    expect(regressions).toEqual([
      {
        role: "plan",
        model: "claude-opus-5-5",
        headline: "Opus 5.5 got slower at planning",
        detail: "Plan steps take about 40% longer since 24 Oct. Cost is unchanged.",
      },
    ]);
  });

  it("names a build model whose threads are accepted first try less often", () => {
    const recent = RECENT_DAYS.map((d, i) => task(d, { changes: i < 3 }));
    const { regressions } = watch([...weeks(6, BEFORE_DAYS), ...recent], STACKS.balanced, NOW);
    // Acceptance belongs to the whole thread, and is put down to the model that built it.
    expect(regressions.map((r) => r.headline)).toEqual(["Sonnet 5.5 got worse at building"]);
    expect(regressions[0].detail).toBe(
      "3 of 6 threads it built were accepted first try since 24 Oct, against 6 of 6 before. Time and cost are unchanged.",
    );
  });

  it("only compares a model the stack uses now, with enough of the person's own work on both sides", () => {
    const slower = weeks(6, RECENT_DAYS, { planSeconds: 60 });
    expect(watch([...weeks(4, BEFORE_DAYS), ...slower], STACKS.balanced, NOW).compared).toBe(false);
    // Trials replay old tasks on other stacks, so they aren't the person's work.
    const trials = weeks(6, BEFORE_DAYS, { kind: "trial" });
    expect(watch([...trials, ...slower], STACKS.balanced, NOW).compared).toBe(false);
    // Plan moved to Sonnet, which hasn't planned anything yet.
    const onSonnet = { ...STACKS.balanced, plan: STACKS.balanced.build };
    expect(watch([...weeks(6, BEFORE_DAYS), ...slower], onSonnet, NOW).regressions).toEqual([]);
  });
});

describe("the Watching row", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function openStack(ledger: LedgerThread[]) {
    const fake = fakeBridge();
    fake.ledger.push(...ledger);
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    });
  }

  it("lists what changed, says when nothing did, and stays away until there's history", async () => {
    const now = Date.now();
    const before = BEFORE_DAYS.map((d) => task(d, { now }));
    await openStack([...before, ...RECENT_DAYS.map((d) => task(d, { now, buildCost: 0.2 }))]);
    expect(screen.getByRole("heading", { name: "Watching" })).toBeTruthy();
    expect(screen.getByText("Sonnet 5.5 costs more for building")).toBeTruthy();
    expect(screen.getByText(/^Build steps cost about 100% more since/)).toBeTruthy();
    cleanup();

    await openStack([...before, ...RECENT_DAYS.map((d) => task(d, { now }))]);
    expect(screen.getByText("No model in your stack got slower, dearer or worse this week.")).toBeTruthy();
    cleanup();

    await openStack(before);
    expect(screen.queryByRole("heading", { name: "Watching" })).toBeNull();
  });
});
