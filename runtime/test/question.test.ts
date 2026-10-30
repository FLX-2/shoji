// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { diffOf } from "../src/git";
import { answerQuestion } from "../src/question";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { roleOf, team, tempRepo } from "./helpers";

describe("a question about the work", () => {
  it("is answered by the scout from the work so far, and changes nothing", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n", ".env": "TOKEN=secret-value\n" });
    fs.writeFileSync(path.join(root, "src/hello.js"), "export default 'hello, shoji';\n");
    fs.writeFileSync(path.join(root, ".env"), "TOKEN=other-secret\n");
    const before = diffOf(root);
    const provider = team(() => true);
    const events: RuntimeEvent[] = [];
    const result = await answerQuestion({
      task: "Make the greeting say hello to Shoji.",
      plan: "Change the greeting.",
      question: "Does it still export a default?",
      seat: STACKS.balanced.scout,
      provider,
      workspace: new Workspace(root, [".env"]),
      cap: 0.1,
      emit: (e) => events.push(e),
    });

    expect(result.status).toBe("answered");
    expect(provider.requests.every((r) => roleOf(r) === "scout" && r.model === STACKS.balanced.scout.model)).toBe(true);
    const prompt = JSON.stringify(provider.requests[0].messages[0]);
    expect(prompt).toContain("The person asks: Does it still export a default?");
    expect(prompt).toContain("+export default 'hello, shoji';");
    expect(prompt).not.toContain("other-secret");
    expect(events.find((e) => e.type === "step" && e.status === "done")).toMatchObject({
      step: "answer",
      output: expect.stringContaining("The greeting lives in src/hello.js."),
    });
    expect(diffOf(root)).toBe(before);
  });
});
