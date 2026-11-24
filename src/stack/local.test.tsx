import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound, NAMED } from "../../runtime/src/models";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { parseLock } from "./lock";
import { familyOf, priceLine } from "./ModelPick";
import { localStack } from "./ollama";

describe("LM Studio and llama.cpp", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("local", {});
    applyFound(NAMED, {});
  });

  it("lets setup go on with a local server alone, on a stack that runs there", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.local.found = { name: "LM Studio", models: ["qwen/qwen3-coder-30b", "google/gemma-3-12b"] };
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    expect(
      await screen.findByText(
        "qwen3-coder-30b, gemma-3-12b on LM Studio. Free, and your code stays on this computer. Load models with a context of 32K or more.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("LM Studio is connected")).toBeTruthy();
    const stacks = within(screen.getByRole("radiogroup", { name: "Starting stack" }));
    expect(stacks.getAllByRole("radio").map((r) => r.textContent)).toEqual(["On my local server"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start using Shoji" }));
    });
    expect(parseLock(fake.files.stackLock!).versions.at(-1)!.stack).toEqual(
      localStack(["local/qwen/qwen3-coder-30b", "local/google/gemma-3-12b"]),
    );
    expect(familyOf("local/qwen/qwen3-coder-30b")).toBe("Local server");
    expect(priceLine("local/qwen/qwen3-coder-30b")).toBe("Free, on this computer");
  });

  it("says in Settings how to get a local server going when none answers, and looks again", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
    expect(
      await screen.findByText(
        "Models on this computer through LM Studio or llama.cpp's server. Start its server with a model loaded, then look again.",
      ),
    ).toBeTruthy();
    fake.local.found = { name: "llama.cpp", models: ["qwen3-coder-30b.gguf"] };
    const row = screen.getByText("LM Studio and llama.cpp").closest(".srow") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Look for LM Studio or llama.cpp again" }));
    });
    expect(within(row).getByText(/^qwen3-coder-30b on llama\.cpp\./)).toBeTruthy();
  });
});
