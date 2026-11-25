import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { geminiModel } from "../../runtime/src/found";
import { applyFound } from "../../runtime/src/models";
import { describeStack } from "./lock";
import { geminiFreeStack, geminiStack } from "./gemini";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const PREFS = { setupDone: true, repo: "/work/pricing-page" };

const openModels = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
  await act(async () => {});
};

const saveKey = async () => {
  fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "AIza-test" } });
  await act(async () => {
    fireEvent.submit(screen.getByLabelText(/Gemini API key/).closest("form")!);
  });
};

describe("Gemini", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("gemini", {});
  });

  it("says what the free tier means before a key is saved, then offers its free models", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.prefs", JSON.stringify(PREFS));
    render(<App bridge={fake.bridge} />);
    await openModels();
    expect(
      screen.getByText(
        "A key from Google AI Studio. On the free tier, steps cost nothing, Google limits how many run a day, and Google may use what Shoji sends to improve its models.",
      ),
    ).toBeTruthy();

    await saveKey();
    expect(fake.calls.savedKeys).toContain("AIza-test");
    expect(screen.getByText(/^Saved in your system keychain\. 2 models\. On the free tier/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    const presets = within(screen.getByRole("radiogroup", { name: "Preset" }));
    fireEvent.click(presets.getByRole("radio", { name: "Gemini free tier" }));
    expect(screen.getByText("Gemini 3.5 Flash plans and builds and Gemini 3.1 Flash-Lite scouts and reviews.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Build model" }));
    const list = within(screen.getByRole("listbox"));
    expect(list.getByRole("option", { name: /Gemini 3.5 Flash/ }).textContent).toBe("Gemini 3.5 FlashOn Gemini's free tier");
    expect(list.queryByRole("option", { name: /Gemini 3.1 Pro/ })).toBeNull();
  });

  it("offers every model it can price on a paid key, at Google's prices", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.prefs", JSON.stringify({ ...PREFS, geminiTier: "paid" }));
    render(<App bridge={fake.bridge} />);
    await openModels();
    await saveKey();
    expect(screen.getByText(/3 models\. Billed by Google at its API prices/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Preset" })).getByRole("radio", { name: "Gemini" }));
    expect(screen.getByText("Gemini 3.1 Pro Preview plans and builds and Gemini 3.1 Flash-Lite scouts and reviews.")).toBeTruthy();
  });

  it("hands a run its Gemini models as free, so the runtime charges nothing for them", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.prefs", JSON.stringify(PREFS));
    render(<App bridge={fake.bridge} />);
    await openModels();
    await saveKey();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Preset" })).getByRole("radio", { name: "Gemini free tier" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save as version/ }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].models?.models["gemini/gemini-3.5-flash"]).toMatchObject({ billing: "free" });
  });
});

/** The conversation models Google listed for a new free key on 25 Nov 2026, in its order. */
const LISTED_FOR_A_NEW_KEY = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-pro-latest",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-omni-flash-preview",
  "gemini-3.6-flash",
  "gemini-4-argon",
];

describe("Gemini's free tier preset", () => {
  afterEach(() => applyFound("gemini", {}));

  /** What the app does with Google's list: the models offered free, dearest first. */
  const offered = (ids: string[]) => {
    const found = ids.map((id) => geminiModel(id, id, true)).filter((m) => m !== null);
    applyFound("gemini", Object.fromEntries(found));
    return found.sort(([, a], [, b]) => b.output - a.output).map(([id]) => id);
  };

  it("seats only models a new key can run, each step on its own daily allowance", () => {
    const stack = geminiFreeStack(offered(LISTED_FOR_A_NEW_KEY));
    expect(stack).toEqual({
      build: { model: "gemini/gemini-3.6-flash", effort: "medium" },
      plan: { model: "gemini/gemini-3-flash-preview", effort: "medium" },
      review: { model: "gemini/gemini-3.5-flash-lite", effort: "low" },
      scout: { model: "gemini/gemini-3.1-flash-lite", effort: "low" },
    });
  });

  it("keeps plan with build when the key has two free models", () => {
    const stack = geminiFreeStack(offered(["gemini-2.5-pro", "gemini-3.5-flash", "gemini-3.1-flash-lite-preview"]));
    expect(describeStack(stack)).toBe("gemini-3.5-flash plans and builds and gemini-3.1-flash-lite-preview scouts and reviews.");
  });

  it("never seats a model Google no longer serves to new keys on a paid key", () => {
    const paid = ["gemini/gemini-3.1-pro-preview", "gemini/gemini-2.5-pro", "gemini/gemini-3.5-flash", "gemini/gemini-2.5-flash-lite"];
    const stack = geminiStack(paid);
    expect(stack.build.model).toBe("gemini/gemini-3.1-pro-preview");
    expect(stack.review.model).toBe("gemini/gemini-3.5-flash");
  });
});
