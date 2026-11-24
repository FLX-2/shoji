import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import { planStack } from "../stack/chatgpt";
import { localStack } from "../stack/ollama";
import { carryOnRoutes, opensAt } from "../stack/routes";
import { fakeBridge } from "../test/fakeBridge";

const PLAN = planStack(["chatgpt/gpt-5.5", "chatgpt/gpt-5.5-mini"]);
const LOCAL = localStack(["ollama/gemma4:31b", "ollama/qwen3:4b"]);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("routes to carry on with", () => {
  const all = () => true;

  it("moves only the seats on the provider that ran out, and offers what spends nothing first", () => {
    const mixed = { ...LOCAL, review: PLAN.review };
    const routes = carryOnRoutes(
      mixed,
      "chatgpt",
      [
        { name: "Your stack", stack: STACKS.balanced },
        { name: "On this computer", stack: LOCAL },
      ],
      all,
    );
    expect(routes.map((r) => r.name)).toEqual(["Ollama", "Anthropic"]);
    expect(routes[0].stack).toEqual(LOCAL);
    expect(routes[1].stack).toEqual({ ...LOCAL, review: STACKS.balanced.review });
  });

  it("leaves out stacks on the same provider, models the person can't run, and offers at most two", () => {
    const candidates = [
      { name: "On my ChatGPT plan", stack: PLAN },
      { name: "Your stack", stack: STACKS.balanced },
      { name: "On this computer", stack: LOCAL },
      { name: "OpenAI", stack: { ...PLAN, plan: { model: "openai/gpt-6.1-sol", effort: "medium" as const } } },
    ];
    expect(carryOnRoutes(PLAN, "chatgpt", candidates, (m) => !m.startsWith("ollama/")).map((r) => r.name)).toEqual([
      "Anthropic",
    ]);
    expect(carryOnRoutes(PLAN, "chatgpt", candidates, all)).toHaveLength(2);
    // Nothing ran on the provider, so there's nothing to move.
    expect(carryOnRoutes(LOCAL, "chatgpt", candidates, all)).toEqual([]);
  });

  it("says when a limit lifts in the person's own day", () => {
    const now = new Date(2026, 10, 24, 11, 0).getTime();
    expect(opensAt(new Date(2026, 10, 24, 15, 40).getTime(), now)).toMatch(/^at 3:40\sPM$/);
    expect(opensAt(new Date(2026, 10, 25, 0, 0).getTime(), now)).toMatch(/^tomorrow at 12:00\sAM$/);
    expect(opensAt(new Date(2026, 10, 27, 9, 0).getTime(), now)).toMatch(/^on Friday at 9:00\sAM$/);
  });
});

describe("a thread whose plan ran out", () => {
  const result: RuntimeEvent = {
    type: "result",
    result: {
      status: "stopped",
      reason: "Your ChatGPT plan has reached its limit for Shoji for now.",
      limit: { provider: "chatgpt" },
      plan: "1. Add a billing toggle.",
      diff: "",
      review: "",
      checks: [],
      escalated: false,
      cost: 0,
      costByRole: { scout: 0, plan: 0, build: 0, review: 0 },
    },
  };

  async function stopOnPlan(local: string[] | null) {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.chatgpt.email = "bob@example.com";
    fake.ollama.models = local;
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: PLAN }] });
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page", planFirst: false }));
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add an annual toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.emit(result);
    fake.exit(0);
    await act(async () => {});
    return fake;
  }

  it("says so, and carries on with Ollama on the person's tap, keeping the work", async () => {
    const fake = await stopOnPlan(["gemma4:31b", "qwen3:4b"]);
    expect(screen.getByText(/^Your ChatGPT plan has reached its limit for Shoji for now\. The work so far is kept\.$/)).toBeTruthy();
    // A plan running out is no reason to offer more money.
    expect(screen.queryByRole("button", { name: /^Keep going/ })).toBeNull();
    const carry = screen.getByRole("button", { name: "Carry on with Ollama" });
    expect(carry.className).toBe("btn solid");
    expect(screen.getByRole("button", { name: "Pick up where it stopped" }).className).toBe("btn");
    await act(async () => {
      fireEvent.click(carry);
    });
    expect(fake.calls.starts[1]).toMatchObject({
      stack: LOCAL,
      changes: { thread: 1, plan: "1. Add a billing toggle." },
    });
    expect(screen.getByText("Carry on with Ollama").className).toBe("umsg");
  });

  it("offers only picking up later when nothing else is connected", async () => {
    await stopOnPlan(null);
    expect(screen.queryByRole("button", { name: /^Carry on with/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Pick up where it stopped" }).className).toBe("btn solid");
  });
});
