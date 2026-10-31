import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const step = (name: string, role: string, model: string): RuntimeEvent[] => [
  { type: "step", step: name, role: role as never, model, status: "running" },
  { type: "step", step: name, role: role as never, model, status: "done", output: "Done." },
];

const result = (status: ThreadResult["status"]): RuntimeEvent => ({
  type: "result",
  result: {
    status,
    plan: "1. Add faq.html.",
    diff: "",
    review: status === "ready" ? "VERDICT: APPROVE" : "",
    checks: [],
    escalated: false,
    cost: 0.05,
    costByRole: { scout: 0.01, plan: 0.02, build: 0.01, review: 0.01 },
  },
});

async function finished(planFirst: boolean) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst }));
  const fake = fakeBridge();
  await act(async () => {
    render(<App bridge={fake.bridge} />);
  });
  const box = screen.getByRole("textbox", { name: "Task" });
  fireEvent.change(box, { target: { value: "Add a FAQ" } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
  return fake;
}

const redoButton = (name: RegExp) => screen.getByRole("button", { name });
const items = () => screen.getAllByRole("menuitem").map((m) => m.textContent);

describe("doing a step again on another model", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("builds again from the start or reviews again, from the step's model, once the run has ended", async () => {
    const fake = await finished(false);
    await act(async () => {
      fake.emit(...step("scout", "scout", HAIKU), ...step("plan", "plan", OPUS), ...step("build", "build", SONNET));
    });
    // Nothing is offered while the run works.
    expect(screen.queryByRole("button", { name: /Do it again on another model/ })).toBeNull();
    await act(async () => {
      fake.emit(...step("review", "review", HAIKU), result("ready"));
    });
    await act(async () => fake.exit(0));

    // Reading the code and the plan the work came from can't be done again on their own.
    expect(screen.getAllByRole("button", { name: /Do it again on another model/ })).toHaveLength(2);
    fireEvent.click(redoButton(/^Made the change with Sonnet 5\.5/));
    expect(items()).toEqual(["Build again with Opus 5.5", "Build again with Haiku 5.5"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Build again with Opus 5.5" }));
    });
    expect(fake.calls.starts[1].changes).toMatchObject({ kind: "rebuild", plan: "1. Add faq.html." });
    expect(fake.calls.starts[1].stack.build.model).toBe(OPUS);
    expect(fake.calls.starts[1].stack.plan.model).toBe(OPUS);
    expect(screen.getByText("Build it again with Opus 5.5")).toBeTruthy();

    await act(async () => {
      fake.emit(...step("build", "build", OPUS), ...step("review", "review", HAIKU), result("needs-work"));
    });
    await act(async () => fake.exit(1));
    fireEvent.click(redoButton(/^Reviewed the change with Haiku 5\.5/));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Review again with Sonnet 5.5" }));
    });
    expect(fake.calls.starts[2].changes).toMatchObject({ kind: "review" });
    expect(fake.calls.starts[2].stack.review.model).toBe(SONNET);
    // The build keeps the model it was last done again on.
    expect(fake.calls.starts[2].stack.build.model).toBe(OPUS);
  });

  it("plans again on another model while the plan waits, and pauses again", async () => {
    const fake = await finished(true);
    await act(async () => {
      fake.emit(...step("scout", "scout", HAIKU), ...step("plan", "plan", OPUS), result("planned"));
    });
    await act(async () => fake.exit(0));
    fireEvent.click(redoButton(/^Planned the change with Opus 5\.5/));
    expect(items()).toEqual(["Plan again with Sonnet 5.5", "Plan again with Haiku 5.5"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Plan again with Sonnet 5.5" }));
    });
    expect(fake.calls.starts[1].changes).toMatchObject({ kind: "replan" });
    expect(fake.calls.starts[1].planOnly).toBe(true);
    expect(fake.calls.starts[1].stack.plan.model).toBe(SONNET);
  });
});
