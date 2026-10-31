import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { foldRun, titleIn } from "./fold";

const HAIKU = "claude-haiku-5-5";

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

const list = () => screen.getByRole("navigation", { name: "Threads" });
const titles = (group: string) =>
  within(within(list()).getByRole("region", { name: group }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector("b")!.textContent);

async function openThreads(...threads: LedgerThread[]) {
  const fake = fakeBridge();
  fake.ledger.push(...threads);
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
  });
  return fake;
}

async function menuItem(row: string, item: RegExp | string) {
  await act(async () => {
    fireEvent.click(within(list()).getByRole("button", { name: `More for "${row}"` }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  });
}

describe("a thread's name", () => {
  it("comes from Scout's TITLE: line, which the brief then leaves out", () => {
    expect(titleIn('TITLE: "Annual billing toggle."\nThe cards are in Pricing.tsx.')).toBe("Annual billing toggle");
    expect(titleIn("No title here")).toBeUndefined();
    const events: RuntimeEvent[] = [
      { type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" },
      {
        type: "step",
        step: "scout",
        role: "scout",
        model: HAIKU,
        status: "done",
        output: "TITLE: Annual billing toggle\nThe cards are in Pricing.tsx.",
      },
    ];
    const run = foldRun(events);
    expect(run.title).toBe("Annual billing toggle");
    expect(run.steps[0].output).toBe("The cards are in Pricing.tsx.");
  });
});

describe("thread actions", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows a thread by its title, and renames it in place", async () => {
    const fake = await openThreads(thread(1, "When a run fails or is stopped partway, say why", { title: "Explain failed runs" }));
    expect(titles("Needs you")).toEqual(["Explain failed runs"]);

    await menuItem("Explain failed runs", /^Rename/);
    const field = within(list()).getByRole("textbox", { name: "Thread name" });
    fireEvent.change(field, { target: { value: "Failed runs" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.blur(field);
    });
    expect(fake.ledger[0].title).toBe("Failed runs");
    expect(titles("Needs you")).toEqual(["Failed runs"]);

    // Escape lets the name be.
    await act(async () => {
      fireEvent.keyDown(within(list()).getByRole("button", { name: /^Failed runs/ }), { key: "F2" });
    });
    const again = within(list()).getByRole("textbox", { name: "Thread name" });
    fireEvent.change(again, { target: { value: "Something else" } });
    await act(async () => {
      fireEvent.keyDown(again, { key: "Escape" });
    });
    expect(fake.ledger[0].title).toBe("Failed runs");
  });

  it("pins a thread above the rest, and opens the same menu on a right-click", async () => {
    await openThreads(thread(1, "Fix the footer"), thread(2, "Add a FAQ"));
    expect(titles("Needs you")).toEqual(["Fix the footer", "Add a FAQ"]);
    await act(async () => {
      fireEvent.contextMenu(within(list()).getByRole("button", { name: /^Add a FAQ/ }), { clientX: 40, clientY: 40 });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    });
    expect(titles("Pinned")).toEqual(["Add a FAQ"]);
    expect(titles("Needs you")).toEqual(["Fix the footer"]);
  });

  it("archives a thread with an undo, and keeps it under Archived", async () => {
    const fake = await openThreads(thread(1, "Fix the footer"), thread(2, "Add a FAQ"));
    await menuItem("Add a FAQ", "Archive");
    expect(titles("Needs you")).toEqual(["Fix the footer"]);
    expect(screen.getByText('Archived "Add a FAQ"')).toBeTruthy();
    const archived = within(list()).getByRole("button", { name: /^Archived/ });
    expect(archived.textContent).toBe("Archived 1");
    await act(async () => {
      fireEvent.click(archived);
    });
    expect(titles("Archived")).toEqual(["Add a FAQ"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(fake.ledger[1].archivedAt).toBeNull();
    expect(titles("Needs you")).toEqual(["Fix the footer", "Add a FAQ"]);
  });

  it("asks before discarding work, and can't discard committed work", async () => {
    const fake = await openThreads(
      thread(1, "Fix the footer"),
      thread(2, "Add a FAQ", { committed: "abc1234", committedAt: Date.now() }),
    );
    await act(async () => {
      fireEvent.click(within(list()).getByRole("button", { name: 'More for "Add a FAQ"' }));
    });
    expect(screen.queryByRole("menuitem", { name: /Discard/ })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    });

    await menuItem("Fix the footer", /Discard work/);
    expect(fake.calls.discarded).toEqual([]);
    expect(screen.getByText(/Delete shoji\/thread-1 and this thread's copy/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Discard" }));
    });
    expect(fake.calls.discarded).toEqual([1]);
    expect(within(list()).queryByRole("region", { name: "Needs you" })).toBeNull();
  });

  it("opens the thread's folder and copies its branch from the title bar", async () => {
    const fake = await openThreads(thread(1, "Fix the footer"));
    await act(async () => {
      fireEvent.click(within(list()).getByRole("button", { name: /^Fix the footer/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Open folder" }));
    });
    expect(fake.calls.revealed).toEqual(["/data/worktrees/thread-1"]);
  });
});
