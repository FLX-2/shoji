import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { startersIn } from "./starters";

const thread = (id: number, task: string, repo: string): LedgerThread => ({
  id,
  task,
  repo,
  branch: `shoji/thread-${id}`,
  workdir: `/data/worktrees/thread-${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 60_000,
  committed: null,
  committedAt: null,
  runs: [{ id: id * 10, kind: "task", startedAt: Date.now(), status: "needs-work", calls: [] }],
});

const needsWork: RuntimeEvent[] = [
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

const prefs = () => JSON.parse(localStorage.getItem("shoji.prefs")!);
const click = async (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

async function launch(saved: object, ...threads: LedgerThread[]) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false, ...saved }));
  const fake = fakeBridge();
  fake.ledger.push(...threads);
  for (const t of threads) fake.logs[t.id * 10] = needsWork;
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  return fake;
}

describe("projects", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("picks a known project from the composer's project chip", async () => {
    await launch({}, thread(1, "Fix the build", "/work/docs-site"), thread(2, "Add a FAQ", "/work/pricing-page"));
    const chip = screen.getByRole("button", { name: "pricing-page" });
    expect(chip.getAttribute("aria-haspopup")).toBe("menu");
    await click(chip);
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "docs-site",
      "pricing-page✓",
      "Open another folder…",
    ]);
    await click(screen.getByRole("menuitem", { name: "docs-site" }));
    expect(prefs().repo).toBe("/work/docs-site");
  });

  it("removes a project from the list, with an undo, and keeps its threads", async () => {
    const fake = await launch(
      {},
      thread(1, "Fix the build", "/work/docs-site"),
      thread(2, "Add a FAQ", "/work/pricing-page"),
      thread(3, "Old post", "/work/blog"),
    );
    const list = () => screen.getByRole("navigation", { name: "Projects" });
    await click(within(list()).getByRole("button", { name: "More for pricing-page" }));
    expect(screen.getByRole("menuitem", { name: "Remove from list" }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    });
    await click(within(list()).getByRole("button", { name: "More for blog" }));
    await click(screen.getByRole("menuitem", { name: "Open folder" }));
    expect(fake.calls.revealed).toEqual(["/work/blog"]);
    await click(within(list()).getByRole("button", { name: "More for blog" }));
    await click(screen.getByRole("menuitem", { name: "Remove from list" }));
    expect(within(list()).queryByRole("button", { name: /^blog/ })).toBeNull();
    expect(fake.ledger).toHaveLength(3);
    await click(screen.getByRole("button", { name: "Undo" }));
    expect(within(list()).getByRole("button", { name: /^blog/ })).toBeTruthy();
  });

  it("changes the quality of a thread's next run from its composer", async () => {
    const fake = await launch({}, thread(1, "Add a FAQ", "/work/pricing-page"));
    await click(screen.getByRole("button", { name: "Threads" }));
    await click(within(screen.getByRole("navigation", { name: "Threads" })).getByRole("button", { name: /^Add a FAQ/ }));
    const quality = screen.getByRole("radiogroup", { name: "Quality" });
    expect(within(quality).getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked")).toBe("true");
    await click(within(quality).getByRole("radio", { name: "Max" }));
    const box = screen.getByRole("textbox", { name: "Changes" });
    fireEvent.change(box, { target: { value: "Make it blue" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[0].stack.build).toEqual(STACKS.balanced.plan);
  });
});

describe("starter tasks", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("come from the notes' First tasks section", () => {
    expect(
      startersIn("# Site\n\nRun `npm test`.\n\n## First tasks\n\n- Add alt text to the logo\n2. Fix the footer year\n\n## Other\n- no"),
    ).toEqual(["Add alt text to the logo", "Fix the footer year"]);
    expect(startersIn("# Site")).toEqual([]);
  });

  it("are offered on a first run, put in the box by a click or Tab, and cost nothing until sent", async () => {
    const fake = await launch({ starters: { "/work/pricing-page": ["Add alt text to the logo", "Fix the footer year"] } });
    const box = () => screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    expect(box().placeholder).toMatch(/^Add alt text to the logo/);
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Tab" });
    });
    expect(box().value).toBe("Add alt text to the logo");
    await click(screen.getByRole("button", { name: "Fix the footer year" }));
    expect(box().value).toBe("Fix the footer year");
    expect(fake.calls.starts).toEqual([]);
  });
});
