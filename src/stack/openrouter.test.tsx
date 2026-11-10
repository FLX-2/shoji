import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound } from "../../runtime/src/models";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const large = { model: "openrouter/vendor/large", effort: "medium" };
const LARGE_STACK = { scout: large, plan: large, build: large, review: large };
const PREFS = JSON.stringify({ setupDone: true, repo: "/work/pricing-page" });

const openModels = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
  await act(async () => {});
};

describe("OpenRouter", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("openrouter", {});
  });

  it("connects in Settings, and its models join Stack's lists at its prices", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.prefs", PREFS);
    render(<App bridge={fake.bridge} />);
    await openModels();
    expect(screen.getByText(/Hundreds of models from many providers on one account/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect OpenRouter" }));
    });
    expect(fake.openrouter.connects).toBe(1);
    expect(screen.getByText(/Connected\. 2 models that can use tools, at OpenRouter's prices/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    fireEvent.click(screen.getByRole("button", { name: "Build model" }));
    const list = within(screen.getByRole("listbox"));
    expect(list.getByRole("option", { name: /Vendor: Large/ }).textContent).toBe("Vendor: Large$3 in, $15 out");
    expect(list.getByRole("option", { name: /Vendor: Small/ }).textContent).toBe(
      "Vendor: Small (free)Free on OpenRouter",
    );
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    await openModels();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });
    expect(screen.getByRole("button", { name: "Connect OpenRouter" })).toBeTruthy();
  });

  it("says what went wrong when connecting doesn't finish", async () => {
    const fake = fakeBridge();
    fake.openrouter.connectError = "That answer didn't come from OpenRouter. Try connecting again.";
    localStorage.setItem("shoji.prefs", PREFS);
    render(<App bridge={fake.bridge} />);
    await openModels();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect OpenRouter" }));
    });
    expect(screen.getByText("That answer didn't come from OpenRouter. Try connecting again.")).toBeTruthy();
  });

  it("asks to connect on Home when the stack uses OpenRouter's models without it", async () => {
    const fake = fakeBridge();
    localStorage.setItem("shoji.openrouter", JSON.stringify(fake.openrouter.models));
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: LARGE_STACK }] });
    localStorage.setItem("shoji.prefs", PREFS);
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.getByText(/Your stack uses OpenRouter's models/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect OpenRouter in Settings" })).toBeTruthy();
  });

  it("hands a run the prices of the stack's OpenRouter models, which the runtime can't look up", async () => {
    const fake = fakeBridge();
    await fake.bridge.openrouterConnect();
    localStorage.setItem("shoji.openrouter", JSON.stringify(fake.openrouter.models));
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: LARGE_STACK }] });
    localStorage.setItem("shoji.prefs", PREFS);
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].models?.models["openrouter/vendor/large"]).toEqual({
      label: "Vendor: Large",
      input: 3,
      output: 15,
      cacheRead: 0.3,
    });
  });
});
