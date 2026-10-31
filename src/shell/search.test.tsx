import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { matching, type SearchItem } from "./Search";

const thread = (id: number, task: string, repo: string): LedgerThread => ({
  id,
  task,
  repo,
  branch: `shoji/${id}`,
  stack: "balanced",
  startedAt: Date.now() - id * 60_000,
  committed: "abc1234",
  committedAt: Date.now(),
  runs: [{ id, kind: "task", startedAt: Date.now(), status: "ready", calls: [] }],
});

describe("search", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("matches every word typed, in label or detail, and keeps a few from each group", () => {
    const item = (group: string, label: string, detail?: string): SearchItem => ({
      id: label,
      group,
      label,
      detail,
      run: () => {},
    });
    const items = [
      item("Threads", "Fix the footer", "Committed · pricing-page"),
      item("Threads", "Add a FAQ", "Committed · docs"),
      ...Array.from({ length: 9 }, (_, i) => item("Go to", `Page ${i}`)),
    ];
    expect(matching(items, "footer pricing").map((i) => i.label)).toEqual(["Fix the footer"]);
    expect(matching(items, "DOCS").map((i) => i.label)).toEqual(["Add a FAQ"]);
    expect(matching(items, "")).toHaveLength(2 + 6);
  });

  async function app() {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", setupDone: true }));
    const fake = fakeBridge();
    fake.ledger.push(thread(1, "Fix the footer", "/work/pricing-page"), thread(2, "Add a FAQ", "/work/docs"));
    fake.logs[1] = [];
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    return fake;
  }

  it("opens on Ctrl+K, goes with the keyboard to a thread, and closes on Escape", async () => {
    await app();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = screen.getByRole("combobox", { name: /^Search/ });
    fireEvent.change(box, { target: { value: "foot" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Fix the footerCommitted · pricing-page"]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Fix the footer");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("combobox", { name: /^Search/ }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("goes to a settings page or a project from the title bar", async () => {
    await app();
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    fireEvent.change(box, { target: { value: "spend" } });
    fireEvent.click(screen.getByRole("option", { name: /^Spending/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Spending" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /^Search/ }), { target: { value: "docs" } });
    const list = screen.getByRole("listbox", { name: "Results" });
    expect(within(list).getByText("Projects")).toBeTruthy();
    fireEvent.click(within(list).getByRole("option", { name: /^docs\/work\/docs/ }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).repo).toBe("/work/docs");
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
  });
});
