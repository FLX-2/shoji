import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { BrokenWindow, Crash } from "./Crash";

const thread = (id: number, task: string, model: string): [LedgerThread, RuntimeEvent[]] => [
  {
    id,
    task,
    repo: "/work/pricing-page",
    branch: `shoji/thread-${id}`,
    workdir: `/data/worktrees/thread-${id}`,
    stack: "balanced",
    startedAt: Date.now() - id * 1000,
    committed: null,
    committedAt: null,
    runs: [{ id: id * 10, kind: "task", startedAt: Date.now(), status: "failed", calls: [] }],
  },
  [
    { type: "step", step: "scout", role: "scout", model, status: "running" },
    { type: "step", step: "scout", role: "scout", model, status: "done", output: "The footer is in footer.html." },
  ],
];

async function launch(...threads: [LedgerThread, RuntimeEvent[]][]) {
  const fake = fakeBridge();
  for (const [record, events] of threads) {
    fake.ledger.push(record);
    fake.logs[record.id * 10] = events;
  }
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
  });
  return fake;
}

const openRow = async (name: RegExp) =>
  act(async () => {
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Threads" })).getAllByRole("button", { name })[0],
    );
  });

function Thrower({ when }: { when: boolean }): null {
  if (when) throw new Error("A draw went wrong");
  return null;
}

describe("a screen that can't be drawn", () => {
  beforeEach(() => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("opens a thread that ran on a model Shoji no longer lists, under the name its provider knew it by", async () => {
    await launch(thread(1, "Fix the footer", "gemini/gemini-2.0-retired"));
    await openRow(/Fix the footer/);
    expect(screen.getByText("The footer is in footer.html.")).toBeTruthy();
    expect(screen.getByTitle("gemini-2.0-retired")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so in place of the screen, and draws it again when asked", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state = { broken: true };
    const Flaky = () => <Thrower when={state.broken} />;
    render(
      <Crash at="threads:1" fallback={(problem, again) => <button onClick={again}>{problem.message}</button>}>
        <Flaky />
        <p>The thread</p>
      </Crash>,
    );
    expect(screen.getByRole("button", { name: "A draw went wrong" })).toBeTruthy();
    expect(screen.queryByText("The thread")).toBeNull();
    state.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "A draw went wrong" }));
    expect(screen.getByText("The thread")).toBeTruthy();
  });

  it("clears the problem when the person goes somewhere else", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = (at: string, when: boolean) => (
      <Crash at={at} fallback={(problem) => <p role="alert">{problem.message}</p>}>
        <Thrower when={when} />
        <p>Drawn at {at}</p>
      </Crash>
    );
    const { rerender } = render(view("threads:1", true));
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(view("receipts:", false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Drawn at receipts:")).toBeTruthy();
  });

  it("keeps a title bar when the whole window broke, and copies what went wrong for a report", async () => {
    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (text: string) => void copied.push(text) } });
    const again = vi.fn();
    render(<BrokenWindow problem={new Error("A draw went wrong")} version="0.3.0" onAgain={again} />);
    expect(screen.getByRole("alert").textContent).toContain("Your threads and their work are safe");
    expect(screen.getByRole("banner").hasAttribute("data-tauri-drag-region")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy what went wrong" }));
    });
    expect(copied[0]).toContain("Shoji 0.3.0");
    expect(copied[0]).toContain("A draw went wrong");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(again).toHaveBeenCalled();
  });
});
