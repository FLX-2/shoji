import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComparedPage } from "../../runtime/src/compare";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { foldRun } from "./fold";

const SONNET = "claude-sonnet-5-5";
const build: RuntimeEvent = { type: "step", step: "build", role: "build", model: SONNET, status: "running" };
const built: RuntimeEvent = { type: "step", step: "build", role: "build", model: SONNET, status: "done", output: "" };
const look: RuntimeEvent = { type: "tool", step: "build", tool: "look_at_page", target: "/pricing at 1280px" };
const ready: RuntimeEvent = {
  type: "result",
  result: {
    status: "ready",
    plan: "1. Add a billing toggle.",
    diff: "diff --git a/src/Card.tsx b/src/Card.tsx\n",
    review: "VERDICT: APPROVE",
    checks: [],
    escalated: false,
    cost: 0.1,
    costByRole: { scout: 0, plan: 0, build: 0.1, review: 0 },
  },
};
const SHOTS = "/data/runs/1-shots";
const shots = (i: number, sides: ("before" | "after")[] = ["before", "after"]) =>
  [360, 768, 1280].map((width) => ({
    width,
    ...Object.fromEntries(sides.map((side) => [side, `${SHOTS}/${side}-${i}-${width}.png`])),
  }));
const comparing: RuntimeEvent = { type: "compare", status: "running" };
const compared = (pages: ComparedPage[], problem?: string): RuntimeEvent => ({
  type: "compare",
  status: "done",
  pages,
  ...(problem && { problem }),
});

const panelShows = () => screen.queryByRole("tabpanel")?.getAttribute("aria-label") ?? null;

async function startThread(prefs: object = {}) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false, ...prefs }));
  const fake = fakeBridge();
  render(<App bridge={fake.bridge} />);
  const task = await screen.findByRole("textbox", { name: "Task" });
  fireEvent.change(task, { target: { value: "Add annual pricing" } });
  await act(async () => {
    fireEvent.keyDown(task, { key: "Enter" });
  });
  return fake;
}

describe("a run's pages before and after", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("folds into the run", () => {
    expect(foldRun([build, ready, comparing]).compare).toEqual({ running: true, pages: [] });
    const pages = [{ path: "/pricing", shots: shots(1) }];
    expect(foldRun([build, ready, comparing, compared(pages)]).compare).toEqual({ running: false, pages });
  });

  it("is a step of its own, then opens Preview on the page before and after, with a handle to drag", async () => {
    const fake = await startThread();
    await fake.emit(build, look, built, ready, comparing);
    expect(screen.getByText("Comparing the pages before and after", { selector: ".sl" })).toBeTruthy();
    // Build's look opened Preview on the live page.
    expect(panelShows()).toBe("Preview");
    expect(screen.queryByRole("radiogroup", { name: "Show" })).toBeNull();

    await fake.emit(compared([{ path: "/pricing", shots: shots(1) }]));
    await act(async () => {});
    const show = screen.getByRole("radiogroup", { name: "Show" });
    expect(within(show).getByRole("radio", { name: "Before and after" }).getAttribute("aria-checked")).toBe("true");
    const before = screen.getByRole("img", { name: "/pricing before the work, at 1280 px" });
    const after = screen.getByRole("img", { name: "/pricing after the work, at 1280 px" });
    expect(before.getAttribute("src")).toBe(`data:image/png;base64,${btoa(`${SHOTS}/before-1-1280.png`)}`);
    expect(after.getAttribute("src")).toBe(`data:image/png;base64,${btoa(`${SHOTS}/after-1-1280.png`)}`);

    const handle = screen.getByRole("slider", { name: "Before and after" });
    fireEvent.change(handle, { target: { value: "30" } });
    expect(handle.getAttribute("aria-valuetext")).toBe("30% before");

    fireEvent.click(screen.getByRole("radio", { name: "360 px" }));
    await act(async () => {});
    expect(screen.getByRole("img", { name: "/pricing before the work, at 360 px" })).toBeTruthy();

    fireEvent.click(within(show).getByRole("radio", { name: "Live" }));
    expect(screen.getByRole("textbox", { name: "Dev server address" })).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();

    await fake.exit(0);
    expect(screen.getByText("Compared the pages before and after", { selector: ".sl" })).toBeTruthy();
    expect(screen.getByText(/^Ready to accept/, { selector: ".outcome" })).toBeTruthy();
  });

  it("opens from the conversation at the page asked for", async () => {
    const fake = await startThread({ autoPanel: false });
    await fake.emit(
      build,
      look,
      built,
      ready,
      comparing,
      compared([
        { path: "/pricing", shots: shots(1) },
        { path: "/checkout", shots: shots(2) },
      ]),
    );
    await fake.exit(0);
    expect(panelShows()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "/checkout at 360, 768 and 1280 px" }));
    });
    expect(panelShows()).toBe("Preview");
    const pages = screen.getByRole("radiogroup", { name: "Page" });
    expect(within(pages).getByRole("radio", { name: "/checkout" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("img", { name: "/checkout after the work, at 1280 px" })).toBeTruthy();
  });

  it("shows the side it has, and says why the other is missing", async () => {
    const fake = await startThread();
    const problem =
      "Couldn't show the pages as they were before: pnpm dev ended (exit code 1) before it served a page.";
    await fake.emit(
      build,
      look,
      built,
      ready,
      comparing,
      compared([{ path: "/", shots: shots(1, ["after"]) }], problem),
    );
    await act(async () => {});
    expect(screen.getByRole("img", { name: "/ after the work, at 1280 px" })).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText("After", { selector: ".lbl" })).toBeTruthy();
    expect(screen.getAllByText(problem)).toHaveLength(2);
  });

  it("leaves another tab alone, and says nothing when no page could be shown", async () => {
    const fake = await startThread();
    await fake.emit(build, look, built, ready);
    fireEvent.click(screen.getByRole("tab", { name: /^Code/ }));
    await fake.emit(comparing, compared([{ path: "/", shots: shots(1, []) }], "Couldn't show the pages."));
    expect(panelShows()).toBe("Code");
    expect(screen.queryByRole("button", { name: /^\/ at/ })).toBeNull();
    expect(screen.getByText("Couldn't show the pages.")).toBeTruthy();
  });
});
