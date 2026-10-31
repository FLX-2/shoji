import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const thread = (id: number, task: string, more: Partial<LedgerThread> = {}): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: `shoji/thread-${id}`,
  workdir: `/data/worktrees/thread-${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 1000,
  committed: null,
  committedAt: null,
  runs: [{ id: id * 10, kind: "task", startedAt: Date.now(), status: "needs-work", calls: [] }],
  ...more,
});

const planned: RuntimeEvent[] = [
  {
    type: "result",
    result: {
      status: "needs-work",
      plan: "1. Add faq.html.",
      diff: "",
      review: "",
      checks: [],
      escalated: false,
      cost: 0.01,
      costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
    },
  },
];

const list = () => screen.getByRole("navigation", { name: "Threads" });
const go = async (section: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: section }));
  });

async function launch(...threads: LedgerThread[]) {
  const fake = fakeBridge();
  fake.ledger.push(...threads);
  for (const t of threads) fake.logs[t.id * 10] = planned;
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  return fake;
}

const openRow = async (name: RegExp) =>
  act(async () => {
    fireEvent.click(within(list()).getByRole("button", { name }));
  });

describe("moving around", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("starts a new task from Threads without leaving it", async () => {
    const fake = await launch(thread(1, "Fix the footer"));
    await go("Threads");
    await openRow(/^Fix the footer/);
    await go("New task");
    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Threads" }).getAttribute("aria-current")).toBe("page");
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts.map((s) => s.task)).toEqual(["Add a FAQ"]);
  });

  it("keeps what was written and not sent, on Home and in a thread", async () => {
    await launch(thread(1, "Fix the footer"));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Half a thought" } });
    await go("Receipts");
    await go("Home");
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe("Half a thought");

    await go("Threads");
    await openRow(/^Fix the footer/);
    fireEvent.change(screen.getByRole("textbox", { name: "Changes" }), { target: { value: "Make it blue" } });
    await go("Agents");
    await go("Threads");
    expect((screen.getByRole("textbox", { name: "Changes" }) as HTMLTextAreaElement).value).toBe("Make it blue");
  });

  it("opens where the person left it", async () => {
    await launch(thread(1, "Fix the footer"), thread(2, "Add a FAQ"));
    await go("Threads");
    await openRow(/^Add a FAQ/);
    cleanup();

    await launch(thread(1, "Fix the footer"), thread(2, "Add a FAQ"));
    expect(screen.getByRole("button", { name: "Threads" }).getAttribute("aria-current")).toBe("page");
    expect(within(list()).getByRole("button", { name: /^Add a FAQ/ }).getAttribute("aria-current")).toBe("true");
  });

  it("shows one project's threads, folds a group, and hides the list with Ctrl+B", async () => {
    await launch(
      thread(1, "Fix the footer"),
      thread(2, "Write the docs", { repo: "/work/docs" }),
      thread(3, "Add a FAQ", { committed: "abc1234", committedAt: Date.now() }),
    );
    await go("Threads");
    await go("Show threads of");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^docs/ }));
    });
    expect(within(list()).getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent)).toEqual([
      "Write the docs",
    ]);
    await go("Show threads of");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "All projects" }));
    });

    const earlier = within(list()).getByRole("button", { name: "Earlier" });
    await act(async () => {
      fireEvent.click(earlier);
    });
    expect(earlier.getAttribute("aria-expanded")).toBe("false");
    expect(earlier.textContent).toBe("Earlier1");
    expect(within(list()).queryByRole("button", { name: /^Add a FAQ/ })).toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });
    expect(screen.queryByRole("navigation", { name: "Threads" })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });
    expect(screen.getByRole("navigation", { name: "Threads" })).toBeTruthy();
  });

  it("offers a way on from an empty Agents", async () => {
    await launch();
    await go("Agents");
    await go("Start a task");
    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
  });

  it("names the thread's own project and branch in the status bar", async () => {
    await launch(thread(1, "Write the docs", { repo: "/work/docs" }));
    const bar = () => screen.getByRole("contentinfo");
    expect(bar().textContent).toMatch(/^pricing-page/);
    await go("Threads");
    await openRow(/^Write the docs/);
    expect(bar().textContent).toMatch(/^docsshoji\/thread-1/);
  });
});
