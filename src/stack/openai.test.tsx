import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const sol = { model: "openai/gpt-6.1-sol", effort: "medium" };
const SOL_STACK = { scout: sol, plan: sol, build: sol, review: sol };

describe("an OpenAI API key", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("is saved in Settings, and brings OpenAI's models into Stack's lists", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});

    // Before the key, Stack offers none of OpenAI's models.
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Build model" }));
    expect(within(screen.getByRole("listbox")).queryByRole("option", { name: /GPT-6/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
    expect(screen.getByText(/For OpenAI's models at API prices/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/OpenAI API key/), { target: { value: "sk-test" } });
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText(/OpenAI API key/).closest(".srow")!).getByRole("button", { name: "Save" }));
    });
    expect(fake.calls.savedKeys).toContain("sk-test");
    expect(screen.getByText("Saved in your system keychain. Shoji sends it only to OpenAI.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Build model" }));
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /GPT-6.1 Sol/ })).toBeTruthy();
  });

  it("is asked for on Home when the stack uses OpenAI's models without one", async () => {
    const fake = fakeBridge();
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: SOL_STACK }] });
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.getByText(/Shoji needs your OpenAI API key to run/)).toBeTruthy();
  });

  it("runs the stack once a key is in the shell", async () => {
    const fake = fakeBridge();
    fake.setOpenAIKey({ saved: false, fromEnv: true });
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: SOL_STACK }] });
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.queryByText(/needs your OpenAI API key/)).toBeNull();
  });

  it("adds one-tap stacks for the providers that are connected", async () => {
    const fake = fakeBridge();
    fake.setOpenAIKey({ saved: true, fromEnv: false });
    fake.chatgpt.email = "bob@example.com";
    fake.ollama.models = ["gemma4:31b"];
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    const presets = within(screen.getByRole("radiogroup", { name: "Preset" }));
    expect(presets.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Balanced",
      "Opus",
      "Haiku",
      "On my ChatGPT plan",
      "OpenAI",
      "On this computer",
      "Claude checks",
    ]);
    fireEvent.click(presets.getByRole("radio", { name: "Claude checks" }));
    expect(screen.getByText("gemma4:31b plans, builds and scouts and Haiku 5.5 reviews.")).toBeTruthy();
    fireEvent.click(presets.getByRole("radio", { name: "OpenAI" }));
    expect(presets.getByRole("radio", { name: "OpenAI" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("GPT-6.1 Sol plans, GPT-6.1 Terra builds, and GPT-6 Luna scouts and reviews.")).toBeTruthy();
  });
});
