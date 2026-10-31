import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import { STACKS } from "../../runtime/src/stack";
import type { Briefing } from "../../runtime/src/trial";
import App from "../App";
import type { LedgerCall, LedgerRun, LedgerThread } from "../bridge";
import { monthOf, outcome, summarize } from "../receipts/receipts";
import { fakeBridge } from "../test/fakeBridge";

const AT = new Date(2026, 9, 29, 9).getTime();

function call(cost: number): LedgerCall {
  return {
    at: AT,
    step: "plan",
    role: "plan",
    model: "claude-opus-5-5",
    effort: "medium",
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    cost,
    seconds: 1,
  };
}

const run = (kind: LedgerRun["kind"], cost: number): LedgerRun => ({
  id: Math.random(),
  kind,
  startedAt: AT,
  status: "ready",
  calls: [call(cost)],
});

function thread(id: number, task: string, extra: Partial<LedgerThread> = {}): LedgerThread {
  return {
    id,
    task,
    repo: "/work/pricing-page",
    branch: `shoji/t${id}`,
    stack: "balanced",
    startedAt: AT - id,
    committed: `c0ffee${id}`,
    committedAt: AT,
    runs: [run("task", 0.1)],
    ...extra,
  };
}

/** A diff that adds one line to a new file. */
const diff = (path: string, line: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`;

const LEDGER = [
  thread(1, "Add a toggle", { runs: [run("task", 0.1), run("changes", 0.05)] }),
  thread(2, "Fix the header"),
  thread(3, "Not accepted", { committed: null }),
  thread(4, "Another project", { repo: "/work/other" }),
];

describe("trials in Stack", () => {
  beforeEach(() => localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page" })));
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function openStack(ledger = LEDGER) {
    const fake = fakeBridge();
    fake.ledger.push(...ledger);
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    });
    return fake;
  }

  it("replays the project's accepted tasks from where each started, on the stack on screen", async () => {
    const fake = await openStack();
    fireEvent.click(screen.getByRole("button", { name: "Review model" }));
    fireEvent.click(screen.getByRole("option", { name: /Sonnet 5\.5/ }));
    expect(screen.getByText("Trial: Review on Sonnet 5.5, low")).toBeTruthy();
    // Two accepted tasks in this project, so two is the most a trial can replay.
    const counts = screen.getByRole("radiogroup", { name: "Tasks to replay" });
    expect(
      within(counts)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["2"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run trial" }));
    });
    expect(fake.calls.trials).toEqual([
      {
        repo: "/work/pricing-page",
        label: "Trial: Review on Sonnet 5.5, low",
        stack: { ...STACKS.balanced, review: { model: "claude-sonnet-5-5", effort: "low" } },
        cap: 0.5,
        tasks: [
          { task: "Add a toggle", commit: "c0ffee1", was: 0.1 },
          { task: "Fix the header", commit: "c0ffee2", was: 0.1 },
        ],
        privateFiles: DEFAULT_PRIVATE,
      },
    ]);
    // Trying a stack doesn't save it.
    expect(fake.calls.lockWrites).toEqual([]);
  });

  it("shows the task it's on, lights the app as running, and briefs when done", async () => {
    const fake = await openStack();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run trial" }));
    });
    fake.emitTrial(
      { type: "task", index: 0, total: 2, task: "Add a toggle" },
      {
        type: "runtime",
        index: 0,
        event: { type: "call", call: { ...call(0.04), model: "claude-opus-5-5", role: "plan" } },
      },
    );
    expect(screen.getByText("Replaying 1 of 2: Add a toggle")).toBeTruthy();
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("running");
    expect(screen.getByText("this trial")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run trial" })).toBeNull();

    const briefing: Briefing = {
      stack: STACKS.balanced,
      outcomes: [
        {
          task: "Add a toggle",
          commit: "c0ffee1",
          was: 0.1,
          cost: 0.04,
          status: "ready",
          checksPassed: true,
          approved: true,
          diff: diff("src/Toggle.tsx", "export const on = true;"),
          accepted: diff("src/Toggle.tsx", "export const on = false;"),
        },
        {
          task: "Fix the header",
          commit: "c0ffee2",
          was: 0.1,
          cost: 0.06,
          status: "needs-work",
          checksPassed: false,
          approved: false,
          diff: "",
          accepted: diff("src/Header.tsx", "export const tall = false;"),
        },
      ],
      cost: 0.1,
      was: 0.2,
      skipped: 0,
    };
    fake.emitTrial({ type: "briefing", briefing });
    fake.exit(0);
    const region = screen.getByRole("region", { name: "Trial briefing" });
    expect(within(region).getByText("50% less")).toBeTruthy();
    expect(within(region).getByText("$0.10, against $0.20 when they first ran")).toBeTruthy();
    expect(within(region).getAllByText("1 of 2")).toHaveLength(2);
    expect(within(region).getByText("Needs work")).toBeTruthy();
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("idle");

    // Each task's work can be set beside the work that was accepted.
    const [first, second] = within(region).getAllByRole("button", { name: "Compare" });
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(screen.getByRole("region", { name: "This trial" })).getByText(
        (_, el) => el?.className === "tx" && el.textContent === "export const on = true;",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "What you accepted" })).getByText(
        (_, el) => el?.className === "tx" && el.textContent === "export const on = false;",
      ),
    ).toBeTruthy();
    fireEvent.click(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("The trial changed nothing.")).toBeTruthy();
  });

  it("stops when asked", async () => {
    const fake = await openStack();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run trial" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(fake.calls.stops).toBe(1);
    fake.exit(null);
    expect(screen.getByText(/You stopped the trial/)).toBeTruthy();
  });

  it("says what a trial needs before it can run", async () => {
    await openStack([thread(3, "Not accepted", { committed: null })]);
    expect(screen.getByText("A trial replays accepted work. Accept a thread in pricing-page first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run trial" })).toBeNull();
  });
});

describe("trials in Receipts", () => {
  it("count as spend but not as work to accept", () => {
    const trial = thread(5, "Trial: Review on Sonnet 5.5, low", { committed: null, runs: [run("trial", 0.3)] });
    const s = summarize([thread(1, "Accepted first time"), trial], monthOf(AT));
    expect(s.spent).toBeCloseTo(0.4);
    expect(s.firstTry).toBe(1);
    expect(s.trials).toBe(1);
    expect(outcome(trial)).toBe("Trial");
  });
});
