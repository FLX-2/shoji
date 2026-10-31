import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyCatalog, BUILT_IN } from "../../runtime/src/models";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { rolesFor } from "./StackView";

const SONNET_6 = "claude-sonnet-6";
/** The list as it reads once a model comes out after this Shoji was built. */
const CATALOG = {
  updated: "2027-03-01",
  models: { ...BUILT_IN, [SONNET_6]: { label: "Sonnet 6", input: 3, output: 15, cacheRead: 0.3 } },
};

const accepted = (id: number, task: string): LedgerThread => ({
  id,
  task,
  repo: "/work/pricing-page",
  branch: `shoji/t${id}`,
  stack: "balanced",
  startedAt: id,
  committed: `c0ffee${id}`,
  committedAt: id + 1,
  runs: [{ id, kind: "task", startedAt: id, status: "ready", calls: [] }],
});

const savedPrefs = () => JSON.parse(localStorage.getItem("shoji.prefs") ?? "{}");

async function openStack(prefs: object = { seenModels: Object.keys(BUILT_IN) }) {
  // Downloaded just now, so it isn't downloaded again.
  localStorage.setItem("shoji.catalog", JSON.stringify({ catalog: CATALOG, checkedAt: Date.now() }));
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", ...prefs }));
  const fake = fakeBridge();
  fake.ledger.push(accepted(1, "Add a toggle"), accepted(2, "Fix the header"));
  render(<App bridge={fake.bridge} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
  });
  return fake;
}

describe("a model worth a trial", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyCatalog(null);
  });

  it("marks a model the list brings, and puts it on trial for the roles it suits without running anything", async () => {
    const fake = await openStack();
    expect(screen.getByText("Worth a trial")).toBeTruthy();
    expect(screen.getByText(/is new in the model list, at \$3 in, \$15 out per million tokens\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try it on Build" }));
    expect(screen.getByText("Build becomes Sonnet 6, medium.")).toBeTruthy();
    expect(screen.getByText("Trial: Build on Sonnet 6, medium")).toBeTruthy();
    // On screen in the stack, it needs no mark.
    expect(screen.queryByText("Worth a trial")).toBeNull();
    expect(fake.calls.trials).toEqual([]);
    expect(savedPrefs().seenModels).not.toContain(SONNET_6);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run trial" }));
    });
    expect(fake.calls.trials[0].stack).toEqual({ ...STACKS.balanced, build: { model: SONNET_6, effort: "medium" } });
    expect(fake.calls.lockWrites).toEqual([]);
    // Once it has been on trial, it isn't new.
    expect(savedPrefs().seenModels).toContain(SONNET_6);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Worth a trial")).toBeNull();
  });

  it("is marked New in each role's list until it's set aside", async () => {
    await openStack();
    fireEvent.click(screen.getByRole("button", { name: "Plan model" }));
    const option = within(screen.getByRole("listbox")).getByRole("option", { name: /Sonnet 6/ });
    expect(within(option).getByText("New")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Worth a trial")).toBeNull();
    expect(savedPrefs().seenModels).toContain(SONNET_6);
    fireEvent.click(screen.getByRole("button", { name: "Plan model" }));
    expect(within(screen.getByRole("listbox")).queryByText("New")).toBeNull();
  });

  it("isn't new once a saved stack uses it", async () => {
    await openStack();
    fireEvent.click(screen.getByRole("button", { name: "Review model" }));
    fireEvent.click(screen.getByRole("option", { name: /Sonnet 6/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as version 1" }));
    });
    expect(savedPrefs().seenModels).toContain(SONNET_6);
  });

  it("marks nothing the first time Shoji opens, whatever the list holds", async () => {
    await openStack({});
    expect(screen.queryByText("Worth a trial")).toBeNull();
    expect(savedPrefs().seenModels).toContain(SONNET_6);
  });

  it("suits the roles on its own family, or else the roles nearest it in price", () => {
    applyCatalog({
      updated: "2027-03-01",
      models: {
        "claude-haiku-6": { label: "Haiku 6", input: 0.2, output: 1, cacheRead: 0.02 },
        "claude-fable-5-1": { label: "Fable 5.1", input: 10, output: 50, cacheRead: 1 },
        "claude-mid-1": { label: "Mid 1", input: 1, output: 6, cacheRead: 0.1 },
      },
    });
    expect(rolesFor("claude-haiku-6", STACKS.balanced)).toEqual(["scout", "review"]);
    expect(rolesFor("claude-fable-5-1", STACKS.balanced)).toEqual(["plan"]);
    expect(rolesFor("claude-mid-1", STACKS.balanced)).toEqual(["build"]);
  });
});
