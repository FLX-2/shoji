import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

const HAIKU = "claude-haiku-5-5";

const thread = (id: number, task: string, status: LedgerThread["runs"][number]["status"]): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: `shoji/thread-${id}`,
  workdir: `/data/worktrees/thread-${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 1000,
  committed: null,
  committedAt: null,
  runs: [{ id: id * 10, kind: "task", startedAt: Date.now(), status, calls: [] }],
});

const press = async (key: string, more: Partial<KeyboardEventInit> = {}, on: Element | Window = window) =>
  act(async () => {
    fireEvent.keyDown(on, { key, ...more });
  });
const list = () => screen.getByRole("navigation", { name: "Threads" });
const shown = () => within(list()).getAllByRole("button", { current: true })[0]?.querySelector("b")?.textContent;

async function launch(...threads: LedgerThread[]) {
  const fake = fakeBridge();
  fake.ledger.push(...threads);
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  return fake;
}

describe("the keyboard", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("opens a new task, Settings and the shortcuts from anywhere", async () => {
    await launch(thread(1, "Fix the footer", "needs-work"));
    await press("n", { ctrlKey: true });
    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
    await press(",", { ctrlKey: true });
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    await press("/", { ctrlKey: true });
    expect(screen.getByRole("region", { name: "Anywhere" })).toBeTruthy();
  });

  it("steps through threads with Ctrl+Tab, and to the next that needs you", async () => {
    await launch(thread(1, "Fix the footer", "needs-work"), thread(2, "Add a FAQ", "failed"), thread(3, "Write docs", "ready"));
    await press("Tab", { ctrlKey: true });
    expect(shown()).toBe("Fix the footer");
    await press("Tab", { ctrlKey: true });
    expect(shown()).toBe("Write docs");
    await press("Tab", { ctrlKey: true, shiftKey: true });
    expect(shown()).toBe("Fix the footer");
    // Add a FAQ failed, so it's under Earlier and doesn't need the person.
    await press("A", { ctrlKey: true, shiftKey: true });
    expect(shown()).toBe("Write docs");
    await press("A", { ctrlKey: true, shiftKey: true });
    expect(shown()).toBe("Fix the footer");

    // ↓ in the list moves to the next row.
    const first = within(list()).getByRole("button", { name: /^Fix the footer/ });
    first.focus();
    await press("ArrowDown", {}, first);
    expect(document.activeElement).toBe(within(list()).getByRole("button", { name: /^Write docs/ }));
  });

  it("stops a running thread with Esc when the box is empty", async () => {
    const fake = await launch();
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Add a FAQ" } });
    await press("Enter", {}, box);
    await act(async () => {
      fake.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    const next = screen.getByRole("textbox", { name: "What's next" });
    fireEvent.change(next, { target: { value: "and a footer" } });
    await press("Escape", {}, next);
    expect(fake.calls.stops).toBe(0);
    fireEvent.change(next, { target: { value: "" } });
    await press("Escape", {}, next);
    expect(fake.calls.stops).toBe(1);
  });

  it("brings back the last task sent with ↑ in an empty box", async () => {
    const fake = await launch();
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Add a FAQ" } });
    await press("Enter", {}, box);
    await act(async () => fake.exit(0));
    await press("n", { ctrlKey: true });
    const again = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    expect(again.value).toBe("");
    await press("ArrowUp", {}, again);
    expect(again.value).toBe("Add a FAQ");
  });

  it("sizes the text from Look and with Ctrl and + or −", async () => {
    const fake = await launch();
    await press("=", { ctrlKey: true });
    await press("=", { ctrlKey: true });
    await press("=", { ctrlKey: true });
    expect(fake.calls.zoom.at(-1)).toBe(1.25);
    await press("0", { ctrlKey: true });
    await press("-", { ctrlKey: true });
    expect(fake.calls.zoom.at(-1)).toBe(0.9);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    expect(screen.getByRole("radio", { name: "90%" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "110%" }));
    });
    expect(fake.calls.zoom.at(-1)).toBe(1.1);
  });

  it("runs actions from ⌘K, with their keys", async () => {
    await launch(thread(1, "Fix the footer", "needs-work"));
    await press("k", { ctrlKey: true });
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "hide thread list" } });
    const option = screen.getByRole("option", { name: /Hide the thread list/ });
    expect(option.textContent).toBe("Hide the thread listCtrlB");
    await press("Enter", {}, search);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    expect(screen.queryByRole("navigation", { name: "Threads" })).toBeNull();

    await press("k", { ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "quality max" } });
    expect(screen.getByRole("option", { name: /Quality: Max/ })).toBeTruthy();
  });
});
