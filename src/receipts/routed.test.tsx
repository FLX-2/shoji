import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import type { ModelId } from "../../runtime/src/models";
import App from "../App";
import type { LedgerCall, LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { priceAs, routingLine } from "./receipts";

const call = (step: string, role: string, model: ModelId, outputTokens = 2000): LedgerCall => {
  const c = {
    at: Date.now(),
    step,
    role,
    model,
    effort: "medium",
    inputTokens: 20_000,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    seconds: 1,
  } as LedgerCall;
  return { ...c, cost: priceAs(model, c) };
};

const calls = [
  call("scout", "scout", "claude-haiku-5-5"),
  call("plan", "plan", "claude-opus-5-5"),
  call("build", "build", "claude-sonnet-5-5", 8000),
  call("build", "build", "claude-opus-5-5"),
  call("review", "review", "claude-haiku-5-5"),
];

const record: LedgerThread = {
  id: 1,
  task: "Add a FAQ",
  repo: "/work/pricing-page",
  branch: "shoji/add-a-faq",
  workdir: "/data/worktrees/add-a-faq",
  stack: "balanced",
  startedAt: Date.now(),
  committed: null,
  committedAt: null,
  runs: [{ id: 10, kind: "task", startedAt: Date.now(), status: "ready", calls }],
};

const ready: RuntimeEvent[] = [
  {
    type: "result",
    result: {
      status: "ready",
      plan: "1. Add faq.html.",
      diff: "",
      review: "",
      checks: [],
      escalated: false,
      cost: 0.1,
      costByRole: { scout: 0, plan: 0, build: 0, review: 0 },
    },
  },
];

describe("the routing receipt at Accept", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("names the model behind each role, once", () => {
    expect(routingLine(record)).toBe("Haiku read, Opus planned, Sonnet and Opus built, Haiku reviewed");
  });

  async function openThread(prefs: object = {}) {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", ...prefs }));
    const fake = fakeBridge();
    fake.ledger.push(structuredClone(record));
    fake.logs[10] = ready;
    fake.project.diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n";
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Threads" })).getByRole("button", { name: /^Add a FAQ/ }));
    });
    await screen.findByRole("button", { name: "Accept and commit" });
    return fake;
  }

  it("shows what routing did and saved over the review bar, and opens the thread's receipt", async () => {
    await openThread();
    const line = document.querySelector(".routed")!;
    expect(line.textContent).toMatch(
      /^Haiku read, Opus planned, Sonnet and Opus built, Haiku reviewed · about \$0\.\d+ less than Opus aloneView receipt$/,
    );
    await act(async () => {
      fireEvent.click(within(line as HTMLElement).getByRole("button", { name: "View receipt" }));
    });
    expect(screen.getByRole("button", { name: "Receipts" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("row", { current: true }).textContent).toContain("Add a FAQ");
  });

  it("is hidden with Costs off", async () => {
    await openThread({ showCosts: false });
    expect(document.querySelector(".routed")).toBeNull();
  });
});
