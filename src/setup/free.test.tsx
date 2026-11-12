import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound } from "../../runtime/src/models";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { parseLock } from "../stack/lock";
import { freeStack } from "../stack/openrouter";

const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

const stacks = () => within(screen.getByRole("radiogroup", { name: "Starting stack" }));

describe("Starting free", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("openrouter", {});
    applyFound("gemini", {});
  });

  it("says in setup which ways in are free, and starts with a $1 daily limit", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    expect(screen.getByText(/You can start free: ChatGPT runs on your Plus or Pro plan/)).toBeTruthy();
    expect((screen.getByLabelText(/Daily limit/) as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("button", { name: "Start using Shoji" })).toHaveProperty("disabled", true);
  });

  it("lets setup go on with OpenRouter's free models alone", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    await click("Connect OpenRouter");
    expect(stacks().getAllByRole("radio").map((r) => r.textContent)).toEqual(["Free on OpenRouter"]);
    expect(stacks().getByRole("radio", { name: "Free on OpenRouter" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("OpenRouter is connected")).toBeTruthy();
    await click("Start using Shoji");
    expect(parseLock(fake.files.stackLock!).versions.at(-1)!.stack).toEqual(
      freeStack(["openrouter/vendor/small:free"]),
    );
  });

  it("lets setup go on with a Gemini key on the free tier alone", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    fireEvent.change(screen.getByLabelText(/Gemini API key/), { target: { value: "AIza-test" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/Gemini API key/).closest("form")!);
    });
    expect(stacks().getAllByRole("radio").map((r) => r.textContent)).toEqual(["Gemini free tier"]);
    await click("Start using Shoji");
    expect(parseLock(fake.files.stackLock!).versions.at(-1)!.stack.build.model).toBe("gemini/gemini-3.5-flash");
  });

  it("opens a practice project and offers its first task on Home", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.ollama.models = ["gemma4:31b"];
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    await click("Use a practice project");
    expect(screen.getByRole("button", { name: /\/data\/practice/ }).getAttribute("aria-pressed")).toBe("true");
    await click("Start using Shoji");
    const box = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    expect(box.placeholder).toMatch(/^Make the failing tests in test\/basket\.test\.js pass\./);
  });
});
