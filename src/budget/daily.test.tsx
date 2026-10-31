import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { spentOn } from "./daily";

const NOW = new Date();
const YESTERDAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 12).getTime();

function spent(at: number, cost: number): LedgerThread {
  return {
    id: Math.random(),
    task: "Earlier work",
    repo: "/work/pricing-page",
    branch: "shoji/x",
    stack: "balanced",
    startedAt: at,
    committed: null,
    committedAt: null,
    runs: [
      {
        id: 1,
        kind: "task",
        startedAt: at,
        status: "ready",
        calls: [
          {
            at,
            step: "build",
            role: "build",
            model: "claude-sonnet-5-5",
            effort: "medium",
            inputTokens: 1,
            outputTokens: 1,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            cost,
            seconds: 1,
          },
        ],
      },
    ],
  };
}

describe("the daily limit", () => {
  beforeEach(() =>
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", dailyLimit: 1, cap: 0.5 })),
  );
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("counts only today's calls", () => {
    expect(spentOn([spent(Date.now(), 0.3), spent(YESTERDAY, 5)], NOW)).toBeCloseTo(0.3);
  });

  async function home(ledger: LedgerThread[]) {
    const fake = fakeBridge();
    fake.ledger.push(...ledger);
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    return { fake, task };
  }

  it("starts a thread without asking while the day has room for its whole limit", async () => {
    const { fake } = await home([spent(Date.now(), 0.4), spent(YESTERDAY, 5)]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fake.calls.starts).toHaveLength(1);
  });

  it("asks before a thread could take the day past it, and keeps the task when held back", async () => {
    const { fake, task } = await home([spent(Date.now(), 0.7)]);
    const ask = screen.getByRole("alertdialog", { name: "Past today's limit?" });
    expect(ask.textContent).toContain("Today has cost $0.70 of your $1.00 daily limit.");
    expect(document.querySelector("footer.status")!.textContent).toContain("today $0.70 of $1.00");
    expect(ask.textContent).toContain("This thread may spend up to $0.50");
    expect(fake.calls.starts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((task as HTMLTextAreaElement).value).toBe("Add a toggle");
    expect(fake.calls.starts).toHaveLength(0);

    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start anyway" }));
    });
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a toggle"]);
  });

  it("shows today's spend in the status bar, keeping up with a running thread", async () => {
    const { fake } = await home([spent(Date.now(), 0.2)]);
    const status = () => document.querySelector("footer.status")!.textContent;
    expect(status()).toContain("today $0.20 of $1.00");
    // The runtime's call is in the ledger by the time the app hears of it.
    fake.ledger.push(spent(Date.now(), 0.05));
    await act(async () => {
      const { at: _, ...call } = spent(0, 0.05).runs[0].calls[0];
      fake.emit({ type: "call", call });
    });
    expect(status()).toContain("today $0.25 of $1.00");
  });

  it("is set in Settings", async () => {
    render(<App bridge={fakeBridge().bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Spending" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Daily limit/ }), { target: { value: "40" } });
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).dailyLimit).toBe(40);
  });
});
