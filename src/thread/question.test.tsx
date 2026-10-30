import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const HAIKU = "claude-haiku-5-5";

const result = (status: ThreadResult["status"], plan = ""): RuntimeEvent => ({
  type: "result",
  result: {
    status,
    plan,
    diff: "",
    review: status === "ready" ? "VERDICT: APPROVE" : "",
    checks: [],
    escalated: false,
    cost: 0.01,
    costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
  },
});

describe("asking about a thread's work", () => {
  beforeEach(() =>
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false })),
  );
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("answers in the conversation and leaves the thread where it was", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add annual pricing" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.emit(result("ready", "1. Price cards yearly."));
    await act(async () => fake.exit(0));

    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    const box = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(box, { target: { value: "Does the toggle remember its choice?" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[1].changes).toMatchObject({
      kind: "question",
      notes: "Does the toggle remember its choice?",
      plan: "1. Price cards yearly.",
    });

    fake.emit(
      { type: "step", step: "answer", role: "scout", model: HAIKU, status: "running" },
      { type: "step", step: "answer", role: "scout", model: HAIKU, status: "done", output: "No, it resets on reload." },
      result("answered"),
    );
    await act(async () => fake.exit(0));

    expect(screen.getByText("Does the toggle remember its choice?")).toBeTruthy();
    expect(screen.getByText("Answered")).toBeTruthy();
    expect(screen.getByText("No, it resets on reload.")).toBeTruthy();
    // Still ready to accept, with the same ways on.
    expect(document.querySelector(".tbar .stage")?.textContent).toBe("Ready to accept");
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
  });
});
