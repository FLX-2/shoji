import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ollamaModel } from "../../runtime/src/found";
import { applyFound } from "../../runtime/src/models";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import type { LedgerCall, LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { estimateCost, tierStack } from "./tier";

function call(role: LedgerCall["role"], model: string, outputTokens: number, cost: number): LedgerCall {
  return {
    at: 0,
    step: role,
    role,
    model,
    effort: "medium",
    inputTokens: 0,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    cost,
    seconds: 1,
  };
}

/** A finished task whose build wrote `buildTokens` on Sonnet, $10 a million. */
function task(startedAt: number, buildTokens: number, kind: "task" | "trial" = "task"): LedgerThread {
  return {
    id: startedAt,
    task: "Earlier work",
    repo: "/work/pricing-page",
    branch: "shoji/x",
    stack: "balanced",
    startedAt,
    committed: null,
    committedAt: null,
    runs: [
      {
        id: startedAt,
        kind,
        startedAt,
        status: "ready",
        calls: [call("build", "claude-sonnet-5-5", buildTokens, (buildTokens * 10) / 1e6)],
      },
    ],
  };
}

describe("quality tiers", () => {
  it("moves Build and Review down one model for a draft, and Build up to the Plan model for Max", () => {
    expect(tierStack(STACKS.balanced, "balanced")).toBe(STACKS.balanced);
    expect(tierStack(STACKS.balanced, "draft")).toEqual({
      ...STACKS.balanced,
      build: { model: "claude-haiku-5-5", effort: "medium" },
      review: { model: "claude-haiku-5-5", effort: "low" },
    });
    expect(tierStack(STACKS.opus, "draft").build.model).toBe("claude-sonnet-5-5");
    expect(tierStack(STACKS.balanced, "max")).toEqual({ ...STACKS.balanced, build: STACKS.balanced.plan });
  });

  it("leaves a model that charges nothing, or one it no longer lists, where it is for a draft", () => {
    applyFound(
      "ollama",
      Object.fromEntries([ollamaModel("qwen3-coder:30b"), ollamaModel("llama4:8b"), ollamaModel("gemma4:12b")]),
    );
    try {
      const local = (model: string) => ({ ...STACKS.balanced, build: { model, effort: "medium" as const } });
      // Free models all cost the same, so price can't say which is the smaller one.
      for (const model of ["ollama/qwen3-coder:30b", "ollama/llama4:8b", "ollama/gemma4:12b"]) {
        expect(tierStack(local(model), "draft").build.model).toBe(model);
      }
      expect(tierStack(local("gemini/retired-model"), "draft").build.model).toBe("gemini/retired-model");
    } finally {
      applyFound("ollama", {});
    }
  });

  it("keeps a draft on OpenRouter with the same maker, and stays put when that maker has nothing cheaper", () => {
    const model = (label: string, output: number) => ({ label, input: output / 5, output, cacheRead: 0 });
    applyFound("openrouter", {
      "openrouter/anthropic/claude-sonnet-5.5": model("Claude Sonnet 5.5", 10),
      "openrouter/anthropic/claude-haiku-5.5": model("Claude Haiku 5.5", 0.5),
      // Cheaper than Sonnet and dearer than Haiku, from other makers: price alone would have picked these.
      "openrouter/mistralai/mistral-large": model("Mistral Large", 6),
      "openrouter/deepseek/deepseek-chat": model("DeepSeek Chat", 1.1),
    });
    try {
      const stack = {
        ...STACKS.balanced,
        build: { model: "openrouter/anthropic/claude-sonnet-5.5", effort: "medium" as const },
        review: { model: "openrouter/deepseek/deepseek-chat", effort: "low" as const },
      };
      const draft = tierStack(stack, "draft");
      expect(draft.build.model).toBe("openrouter/anthropic/claude-haiku-5.5");
      // DeepSeek has nothing cheaper here, so Review stays on it and doesn't cross to Haiku.
      expect(draft.review.model).toBe("openrouter/deepseek/deepseek-chat");
    } finally {
      applyFound("openrouter", {});
    }
  });

  it("estimates from the middle of recent tasks, priced on the tier's models, once there are enough", () => {
    const history = [task(1, 10_000), task(2, 20_000)];
    expect(estimateCost(history, STACKS.balanced)).toBeNull();
    // Trials replay old tasks, so they don't count as history.
    expect(estimateCost([...history, task(3, 90_000, "trial")], STACKS.balanced)).toBeNull();

    history.push(task(3, 30_000));
    expect(estimateCost(history, STACKS.balanced)).toBeCloseTo(0.2); // 20k tokens on Sonnet
    expect(estimateCost(history, tierStack(STACKS.balanced, "max"))).toBeCloseTo(0.4); // on Opus, $20/M
    expect(estimateCost(history, tierStack(STACKS.balanced, "draft"))).toBeCloseTo(0.01); // on Haiku, $0.50/M
  });
});

describe("the tier on Home", () => {
  beforeEach(() => localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false })));
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows what a task usually costs at the picked tier, and starts the thread on that tier's stack", async () => {
    const fake = fakeBridge();
    fake.ledger.push(task(1, 10_000), task(2, 20_000), task(3, 30_000));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});

    expect(screen.getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("about $0.20")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Max" }));
    expect(screen.getByText("about $0.40")).toBeTruthy();

    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[0].stack).toEqual({ ...STACKS.balanced, build: STACKS.balanced.plan });
  });

  it("shows no estimate without history, or with costs hidden", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", showCosts: false }));
    const fake = fakeBridge();
    fake.ledger.push(task(1, 10_000), task(2, 20_000), task(3, 30_000));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.queryByText(/^about \$/)).toBeNull();
    cleanup();

    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {});
    expect(screen.getByRole("radio", { name: "Draft" })).toBeTruthy();
    expect(screen.queryByText(/^about \$/)).toBeNull();
  });
});
