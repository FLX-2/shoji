import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";

function thread(
  id: number,
  task: string,
  repo: string,
  status: LedgerThread["runs"][number]["status"],
  committed = false,
) {
  const at = Date.now() - id * 60_000;
  return {
    id,
    task,
    repo,
    branch: `shoji/${id}`,
    stack: "balanced",
    startedAt: at,
    committed: committed ? "abc1234" : null,
    committedAt: committed ? at : null,
    runs: [{ id, kind: "task", startedAt: at, status, calls: [] }],
  } satisfies LedgerThread;
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function home(ledger: LedgerThread[]) {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", setupDone: true }));
    const fake = fakeBridge();
    fake.ledger.push(...ledger);
    fake.logs[1] = [];
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    return fake;
  }

  it("lists the projects worked in, and switches between them", async () => {
    await home([
      thread(1, "Add a FAQ", "/work/pricing-page", "ready"),
      thread(2, "Fix the build", "/work/docs-site", "needs-work"),
      thread(3, "Tidy the nav", "/work/docs-site", "needs-work"),
      thread(4, "Old work", "/work/blog", "ready", true),
    ]);
    const list = screen.getByRole("navigation", { name: "Projects" });
    const rows = within(list)
      .getAllByRole("button")
      .filter((b) => !b.matches(".add, .more"))
      .map((b) => b.textContent);
    expect(rows[0]).toBe("pricing-page1 needs you");
    expect(rows[1]).toBe("docs-site2 need you");
    expect(rows[2]).toMatch(/^blog\d\d:\d\d$/);
    expect(
      within(list)
        .getByRole("button", { name: /^pricing-page/ })
        .getAttribute("aria-current"),
    ).toBe("true");

    fireEvent.click(within(list).getByRole("button", { name: /^docs-site/ }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).repo).toBe("/work/docs-site");
    const recent = screen.getByRole("region", { name: "Pick up where you left off" });
    expect(
      within(recent)
        .getAllByRole("button")
        .map((b) => b.querySelector("b")!.textContent),
    ).toEqual(["Fix the build", "Tidy the nav"]);
  });

  it("has no projects list for one project, and opens a thread to pick up", async () => {
    await home([
      thread(1, "Add a FAQ", "/work/pricing-page", "ready"),
      thread(2, "Old", "/work/pricing-page", "ready", true),
    ]);
    expect(screen.queryByRole("navigation", { name: "Projects" })).toBeNull();
    const recent = screen.getByRole("region", { name: "Pick up where you left off" });
    expect(within(recent).getAllByRole("button")).toHaveLength(1);
    await act(async () => {
      fireEvent.click(within(recent).getByRole("button", { name: /^Add a FAQ/ }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
  });

  it("says how Shoji works until the first thread, then makes room for the work", async () => {
    await home([]);
    const help = screen.getByRole("region", { name: "How Shoji works" });
    expect(help.textContent).toContain("Nothing is committed or pushed until you say so.");
    cleanup();
    await home([thread(1, "Add a FAQ", "/work/pricing-page", "ready", true)]);
    expect(screen.queryByRole("region", { name: "How Shoji works" })).toBeNull();
  });
});
