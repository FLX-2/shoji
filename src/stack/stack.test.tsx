import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { STACKS, type Stack } from "../../runtime/src/stack";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { describeStack, parseLock, serializeLock, stackOf, stackSummary } from "./lock";

const REVIEW_ON_SONNET: Stack = { ...STACKS.balanced, review: { model: "claude-sonnet-5-5", effort: "medium" } };

describe("stack.lock", () => {
  it("reads back what it writes", () => {
    const lock = {
      versions: [
        { at: 1, stack: STACKS.balanced },
        { at: 2, stack: REVIEW_ON_SONNET },
      ],
    };
    expect(parseLock(serializeLock(lock))).toEqual(lock);
  });

  it("refuses a file that isn't a stack.lock rather than reading it as empty", () => {
    expect(() => parseLock("{}")).toThrow("no list of versions");
    expect(() => parseLock('{"versions":[{"at":1,"stack":{"plan":{"model":"gpt-6","effort":"low"}}}]}')).toThrow(
      "needs a model",
    );
  });

  it("describes a stack in a sentence", () => {
    expect(describeStack(STACKS.balanced)).toBe("Opus 5.5 plans, Sonnet 5.5 builds, and Haiku 5.5 scouts and reviews.");
    expect(describeStack(STACKS.haiku)).toBe("Haiku 5.5 takes every step.");
    expect(describeStack({ ...STACKS.opus, scout: STACKS.haiku.scout })).toBe(
      "Opus 5.5 plans, builds and reviews and Haiku 5.5 scouts.",
    );
  });

  it("reads a ledger thread's stack, recorded as JSON or as an earlier preset name", () => {
    expect(stackOf("haiku")).toEqual(STACKS.haiku);
    expect(stackOf(JSON.stringify(REVIEW_ON_SONNET))).toEqual(REVIEW_ON_SONNET);
    expect(stackOf("not a stack")).toBeNull();
    expect(stackSummary(JSON.stringify(STACKS.balanced))).toBe("Balanced");
    expect(stackSummary(JSON.stringify(REVIEW_ON_SONNET))).toContain("Review Sonnet 5.5, medium");
  });
});

describe("the Stack view", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function openStack(fake = fakeBridge()) {
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    });
    return fake;
  }

  it("shows each role's model and effort, starting from Balanced", async () => {
    await openStack();
    expect(screen.getByText(describeStack(STACKS.balanced))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan model" }).textContent).toBe("Opus 5.5");
    expect(screen.getByRole("button", { name: "Build model" }).textContent).toBe("Sonnet 5.5");
    const scout = screen.getByRole("radiogroup", { name: "Scout effort" });
    expect(within(scout).getByRole("radio", { name: "Low" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
  });

  it("saves a change to stack.lock only when asked, and the next thread uses it", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page" }));
    const fake = await openStack();
    fireEvent.click(screen.getByRole("button", { name: "Review model" }));
    const models = screen.getByRole("listbox", { name: "Review model" });
    expect(
      within(models)
        .getByRole("option", { name: /Haiku 5\.5/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(within(models).getByRole("option", { name: /Sonnet 5\.5/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Review model" }).textContent).toBe("Sonnet 5.5");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Review effort" })).getByRole("radio", { name: "Medium" }),
    );
    expect(fake.calls.lockWrites).toEqual([]);
    expect(screen.getByText("Review becomes Sonnet 5.5, medium.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as version 1" }));
    });
    expect(parseLock(fake.files.stackLock!).versions.map((v) => v.stack)).toEqual([REVIEW_ON_SONNET]);
    expect(screen.queryByRole("button", { name: /Save as/ })).toBeNull();
    const history = screen.getByRole("complementary", { name: "History" });
    expect(within(history).getByText("Version 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].stack).toEqual(REVIEW_ON_SONNET);
  });

  it("discards an unsaved change", async () => {
    const fake = await openStack();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Preset" })).getByRole("radio", { name: "Haiku" }));
    expect(screen.getByText("Haiku 5.5 takes every step.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText(describeStack(STACKS.balanced))).toBeTruthy();
    expect(fake.calls.lockWrites).toEqual([]);
  });

  it("keeps every version and can bring an earlier one back", async () => {
    const fake = fakeBridge();
    fake.files.stackLock = serializeLock({
      versions: [
        { at: new Date(2026, 9, 28, 9).getTime(), stack: STACKS.balanced },
        { at: new Date(2026, 9, 29, 9).getTime(), stack: REVIEW_ON_SONNET },
      ],
    });
    await openStack(fake);
    const history = screen.getByRole("complementary", { name: "History" });
    expect(within(history).getByText("The Balanced stack")).toBeTruthy();
    expect(within(history).getByText("Review on Sonnet 5.5, medium")).toBeTruthy();
    expect(within(history).getByText(/claude-sonnet-5-5/)).toBeTruthy();

    fireEvent.click(within(history).getByRole("button", { name: "Use again" }));
    expect(screen.getByText("Review becomes Haiku 5.5, low.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as version 3" }));
    });
    expect(parseLock(fake.files.stackLock!).versions).toHaveLength(3);
  });

  it("says when stack.lock can't be read", async () => {
    const fake = fakeBridge();
    fake.files.stackLock = "not json";
    await openStack(fake);
    expect(screen.getByText(/stack.lock couldn't be read/)).toBeTruthy();
  });

  it("uses the preset chosen in Settings before stack.lock existed", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ stack: "haiku" }));
    await openStack();
    expect(
      within(screen.getByRole("radiogroup", { name: "Preset" }))
        .getByRole("radio", { name: "Haiku" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("is summed up in Settings, with the way to change it", async () => {
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
    expect(screen.getByText(describeStack(STACKS.balanced))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change in Stack" }));
    expect(screen.getByRole("heading", { level: 2, name: "Which model takes each step" })).toBeTruthy();
  });
});
