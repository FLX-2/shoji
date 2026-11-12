import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound } from "../../runtime/src/models";
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
