import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const SONNET = "claude-sonnet-5-5";

const thread = (id: number, task: string, status: LedgerThread["runs"][number]["status"]): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: `shoji/${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 60_000,
  committed: null,
  committedAt: null,
  runs: [{ id, kind: "task", startedAt: Date.now(), status, calls: [] }],
});

describe("Agents", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("says what shows there before anything runs", async () => {
    await act(async () => {
      render(<App bridge={fakeBridge().bridge} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.getByRole("heading", { name: "Nothing running" })).toBeTruthy();
  });

  it("shows running threads with their step first, then the ones that need you", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    fake.ledger.push(thread(5, "Fix the footer", "needs-work"), thread(6, "Old", "ready"));
    fake.ledger[1].committed = "abc1234";
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.ledger.unshift(thread(1, "Add a FAQ", null));
    await act(async () => {
      fake.emit(
        { type: "step", step: "build", role: "build", model: SONNET, status: "running" },
        { type: "tool", step: "build", tool: "write_file", target: "src/Faq.tsx" },
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    });
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Add a FAQ", "Fix the footer"]);
    expect(cards[0].textContent).toContain("Making the change · Sonnet 5.5");
    expect(cards[0].textContent).toContain("src/Faq.tsx");
    expect(cards[1].textContent).toContain("Needs work");
    expect(screen.getByText("1 needs you")).toBeTruthy();

    fake.logs[5] = [];
    await act(async () => {
      fireEvent.click(within(cards[1]).getByRole("button", { name: "Review changes" }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix the footer");
  });

  it("answers a command, stops a run and builds a plan from the cards", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    const planned = thread(5, "Fix the footer", "planned");
    fake.ledger.push(planned);
    fake.logs[5] = [
      {
        type: "result",
        result: {
          status: "planned",
          plan: "1. Fix the year.",
          diff: "",
          review: "",
          checks: [],
          escalated: false,
          cost: 0.01,
          costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
        },
      },
    ];
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.ledger.unshift(thread(1, "Add a FAQ", null));
    await act(async () => {
      fake.emit(
        { type: "step", step: "build", role: "build", model: SONNET, status: "running" },
        { type: "ask", step: "build", command: "pnpm add marked" },
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Allow "pnpm add marked" for "Add a FAQ"' }));
    });
    expect(fake.calls.answers).toEqual([true]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Stop "Add a FAQ"' }));
    });
    expect(fake.calls.stoppedRuns).toHaveLength(1);

    // A plan from before Shoji opened is read back, then built, without leaving Agents.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Build the plan of "Fix the footer"' }));
    });
    expect(fake.calls.starts.at(-1)).toMatchObject({ ask: "Build it", changes: { thread: 5, kind: "build" } });
    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
  });
});
