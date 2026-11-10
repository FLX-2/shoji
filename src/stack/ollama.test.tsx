import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound, MODELS } from "../../runtime/src/models";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { parseLock } from "./lock";
import { modelGroups, priceLine } from "./ModelPick";
import { localStack } from "./ollama";
import { tierStack } from "./tier";

const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

describe("Ollama", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("ollama", {});
  });

  it("lets setup go on with models on this computer alone, on a stack that runs there", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.ollama.models = ["gemma4:31b", "qwen3:4b"];
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    await click("Set up Shoji");
    expect(await screen.findByText("gemma4:31b, qwen3:4b. Free, and your code stays on this computer.")).toBeTruthy();
    expect(screen.getByText("Ollama is connected")).toBeTruthy();
    await click("Continue");

    // Anthropic's stacks need its key, so only the stack on this computer is offered.
    const stacks = within(screen.getByRole("radiogroup", { name: "Starting stack" }));
    expect(stacks.getAllByRole("radio").map((r) => r.textContent)).toEqual(["On this computer"]);
    expect(stacks.getByRole("radio", { name: "On this computer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("gemma4:31b plans and builds and qwen3:4b scouts and reviews.")).toBeTruthy();
    await click("Continue");
    expect(parseLock(fake.files.stackLock!).versions.at(-1)!.stack).toEqual(
      localStack(["ollama/gemma4:31b", "ollama/qwen3:4b"]),
    );
  });

  it("says in Settings what Ollama has, and how to get it when it isn't running", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
    expect(await screen.findByText(/Install Ollama from ollama.com/)).toBeTruthy();

    fake.ollama.models = ["gemma4:31b"];
    await click("Look again");
    expect(screen.getByText("gemma4:31b. Free, and your code stays on this computer.")).toBeTruthy();
    fake.ollama.models = [];
    await click("Look again");
    expect(screen.getByText(/none of its models can use tools/)).toBeTruthy();
  });

  it("runs a stack on this computer without an Anthropic key", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.ollama.models = ["gemma4:31b"];
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: localStack(["ollama/gemma4:31b"]) }] });
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.queryByText(/needs your Anthropic API key/)).toBeNull();
  });

  it("lists its models under Ollama, free, and keeps a draft on the same provider", () => {
    applyFound("ollama", {
      "ollama/gemma4:31b": { label: "gemma4:31b", input: 0, output: 0, cacheRead: 0, billing: "local" },
    });
    expect(modelGroups().map((g) => g.family)).toEqual(["Opus", "Sonnet", "Haiku", "Ollama"]);
    expect(priceLine("ollama/gemma4:31b")).toBe("Free, on this computer");
    // Haiku is Anthropic's cheapest, so a draft keeps it rather than moving to a free model.
    expect(tierStack(STACKS.balanced, "draft").review.model).toBe("claude-haiku-5-5");
    expect(MODELS["ollama/gemma4:31b"].billing).toBe("local");
  });
});
