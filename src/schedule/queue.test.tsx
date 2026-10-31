import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { matchThreads, threadsMentioned } from "../shell/mention";

const HAIKU = "claude-haiku-5-5";
const prefs = () => JSON.parse(localStorage.getItem("shoji.prefs")!);

async function launch(saved: object = {}, ...threads: LedgerThread[]) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false, ...saved }));
  const fake = fakeBridge();
  fake.ledger.push(...threads);
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  return fake;
}

const send = async (box: HTMLElement, value: string) => {
  fireEvent.change(box, { target: { value } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
};

describe("next in line", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("waits while a thread runs, then starts by itself", async () => {
    const fake = await launch();
    await send(screen.getByRole("textbox", { name: "Task" }), "Add a FAQ");
    await act(async () => {
      fake.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    });
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("radio", { name: "Next in line" }));
    expect(screen.getByText("Starts when nothing else runs, within today's limit")).toBeTruthy();
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.getByRole("button", { name: "Put it in line" })).toBeTruthy();
    await send(box, "Fix the footer");

    expect(fake.calls.starts).toHaveLength(1);
    const line = screen.getByRole("region", { name: "Next in line" });
    expect(within(line).getByText("Fix the footer")).toBeTruthy();
    expect(within(line).getByText("Starts when nothing else runs")).toBeTruthy();

    await act(async () => fake.exit(0));
    expect(fake.calls.starts).toHaveLength(2);
    expect(fake.calls.starts[1]).toMatchObject({ task: "Fix the footer", repo: "/work/pricing-page" });
    expect(fake.calls.starts[1].planOnly).toBeFalsy();
    expect(prefs().queue).toEqual([]);
    expect(screen.queryByRole("region", { name: "Next in line" })).toBeNull();
  });

  it("holds the first in line when it could take the day past the limit, and can take it out", async () => {
    const fake = await launch({
      dailyLimit: 0.5,
      cap: 1,
      queue: [{ id: "q1", task: "Fix the footer", repo: "/work/pricing-page", tier: "balanced" }],
    });
    expect(fake.calls.starts).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    const line = screen.getByRole("region", { name: "Next in line" });
    expect(within(line).getByText(/^Waiting: it could take today past your \$0\.50 limit$/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(line).getByRole("button", { name: 'Take "Fix the footer" out of line' }));
    });
    expect(prefs().queue).toEqual([]);
    expect(screen.queryByRole("region", { name: "Next in line" })).toBeNull();
  });
});

const past: LedgerThread = {
  id: 1,
  task: "Add a FAQ",
  repo: "/work/pricing-page",
  branch: "shoji/add-a-faq",
  workdir: "/data/worktrees/add-a-faq",
  stack: "balanced",
  startedAt: Date.now() - 60_000,
  committed: "abc1234",
  committedAt: Date.now() - 30_000,
  runs: [{ id: 10, kind: "task", startedAt: Date.now() - 60_000, status: "ready", calls: [] }],
};

const ready: RuntimeEvent[] = [
  {
    type: "result",
    result: {
      status: "ready",
      plan: "1. Add faq.html with five questions.",
      diff: "",
      review: "The answers are short.\n\nVERDICT: ACCEPT",
      checks: [],
      escalated: false,
      cost: 0.1,
      costByRole: { scout: 0, plan: 0, build: 0, review: 0 },
    },
  },
];

describe("@ an earlier thread", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("finds threads by their title and reads them back out of a task", () => {
    const threads = [
      { id: 1, title: "Add a FAQ" },
      { id: 2, title: "Fix the FAQ links" },
      { id: 3, title: "Write docs" },
    ];
    expect(matchThreads(threads, "faq").map((t) => t.id)).toEqual([1, 2]);
    expect(matchThreads(threads, "fix").map((t) => t.id)).toEqual([2]);
    expect(threadsMentioned("Follow @“Add a FAQ” and @“Write docs” up")).toEqual(["Add a FAQ", "Write docs"]);
  });

  it("offers a thread after @ and carries its plan and review into the new task", async () => {
    const fake = await launch({}, past);
    fake.logs[10] = ready;
    const box = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    const value = "Link @FA";
    fireEvent.change(box, { target: { value, selectionStart: value.length } });
    const option = screen.getByRole("option", { name: /Add a FAQ/ });
    expect(option.textContent).toBe("Add a FAQThread");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("Link @“Add a FAQ” ");

    fireEvent.change(box, { target: { value: "Link @“Add a FAQ” from the footer" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    const task = fake.calls.starts[0].task;
    expect(task).toMatch(/^Link @“Add a FAQ” from the footer\n\nThe task names earlier threads/);
    expect(task).toContain("From “Add a FAQ”:");
    expect(task).toContain("1. Add faq.html with five questions.");
    expect(task).toContain("The answers are short.");
  });
});
