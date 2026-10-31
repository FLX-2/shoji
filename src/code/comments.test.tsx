import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { commentsNote } from "./comments";

const DIFF = `diff --git a/src/Card.tsx b/src/Card.tsx
index 1111111..2222222 100644
--- a/src/Card.tsx
+++ b/src/Card.tsx
@@ -1,2 +1,2 @@
-export const price = plan.monthly;
+export const price = plan.annual / 12;
 export default price;
`;

describe("comments on the code", () => {
  it("read as one request, in file and line order", () => {
    expect(
      commentsNote([
        { path: "src/b.ts", line: 3, removed: false, code: "b()", text: "Rename it." },
        { path: "src/a.ts", line: 9, removed: true, code: "", text: "Keep this line." },
      ]),
    ).toBe(
      "Comments on the code:\n- src/a.ts, removed line 9: Keep this line.\n- src/b.ts, line 3 (`b()`): Rename it.",
    );
  });
});

describe("commenting on a thread's diff", () => {
  beforeEach(() =>
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false })),
  );
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function finishedThread() {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add annual pricing" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.project.diff = DIFF;
    fake.emit({
      type: "result",
      result: {
        status: "ready",
        plan: "1. Price cards yearly.",
        diff: DIFF,
        review: "VERDICT: APPROVE",
        checks: [],
        escalated: false,
        cost: 0.1,
        costByRole: { scout: 0, plan: 0, build: 0.1, review: 0 },
      },
    });
    await act(async () => fake.exit(0));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    });
    return fake;
  }

  function comment(line: string, text: string) {
    fireEvent.click(screen.getByRole("button", { name: `Comment on ${line}` }));
    const box = screen.getByRole("textbox", { name: /^Comment on line/ });
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  }

  it("collects comments under their lines and sends them to Build as one request", async () => {
    const fake = await finishedThread();
    comment("line 1", "Round it to whole dollars.");
    comment("removed line 1", "Keep monthly as an option.");
    expect(screen.getByText("Round it to whole dollars.")).toBeTruthy();
    expect(screen.getByText("2 comments for Build")).toBeTruthy();

    // The removed line comes first in the diff, so its comment does too.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByText("1 comment for Build")).toBeTruthy();
    comment("line 2", "Export it by name too.");

    // Escape drops a comment that's being written.
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 2" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment on line 2" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Comment on line 2" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to Build" }));
    });
    const note =
      "Comments on the code:\n- src/Card.tsx, line 1 (`export const price = plan.annual / 12;`): Round it to whole dollars.\n- src/Card.tsx, line 2 (`export default price;`): Export it by name too.";
    expect(fake.calls.starts[1].changes?.notes).toBe(note);
    // The request shows up in the conversation, beside the code it's about.
    expect(screen.getByRole("complementary", { name: "Code" })).toBeTruthy();
  });

  it("takes no comments once the thread is committed", async () => {
    const fake = await finishedThread();
    fake.bridge.commitThread = async () => "abc1234";
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept and commit" }));
    });
    expect(screen.queryByRole("button", { name: /^Comment on/ })).toBeNull();
  });
});
