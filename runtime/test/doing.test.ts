// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { runThread } from "../src/pipeline";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, team, tempRepo } from "./helpers";

describe("what a running step is doing", () => {
  it("says when a step waits on its model and when it runs the checks, each with when it started", async () => {
    const events: RuntimeEvent[] = [];
    const before = Date.now();
    await runThread({
      task: "Make the greeting say hello to Shoji.",
      stack: STACKS.balanced,
      provider: team(() => true),
      workspace: new Workspace(tempRepo({ "src/hello.js": "export default 'hello';\n" })),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
    });

    // Every model call is told before it's made, so the thread can say the step is thinking while it waits.
    const calls = events.filter((e) => e.type === "call");
    const thinking = events.filter((e) => e.type === "doing" && e.what === "thinking");
    expect(thinking.length).toBe(calls.length);
    const lastDoing = (before: number) => events.slice(0, before).filter((e) => e.type === "doing").at(-1);
    events.forEach((e, i) => {
      if (e.type === "call") expect(lastDoing(i)).toMatchObject({ step: e.call.step, what: "thinking" });
    });
    // The checks after the build are told before they run.
    const checks = events.findIndex((e) => e.type === "checks");
    expect(lastDoing(checks)).toMatchObject({ step: "build", what: "checks" });
    // Steps, tools and what's doing carry when they started.
    for (const e of events) {
      if ((e.type === "step" && e.status === "running") || e.type === "tool" || e.type === "doing")
        expect(e.at).toBeGreaterThanOrEqual(before);
    }
  });
});
