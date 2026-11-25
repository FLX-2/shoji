// @vitest-environment node
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { Inbox } from "../src/inbox";
import { QUICK_PLAN, runThread } from "../src/pipeline";
import { answerQuestion } from "../src/question";
import { STACKS } from "../src/stack";
import { SteerBox, steerIn } from "../src/steer";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

const text = (content: unknown) => JSON.stringify(content);

describe("steering a run", () => {
  it("reads a steer line apart from answers and tokens", async () => {
    expect(steerIn('{"steer":"use the old client"}')).toBe("use the old client");
    expect(steerIn('{"allow":true}')).toBeNull();
    expect(steerIn("y")).toBeNull();
    const input = new PassThrough();
    const inbox = new Inbox(input);
    input.write('{"steer":"first"}\n{"allow":true}\n{"steer":"second"}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(inbox.takeSteers()).toEqual(["first", "second"]);
    expect(inbox.takeSteers()).toEqual([]);
    expect(await inbox.next("answer")).toBe('{"allow":true}');
  });

  it("tells Build what the person wrote at its next turn, and says so", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const box = new SteerBox();
    const base = team(() => true);
    let builds = 0;
    const provider = new ScriptedProvider((request, i) => {
      // The person writes while Build makes its first call.
      if (roleOf(request) === "builder" && builds++ === 0) box.add("Keep the greeting lowercase");
      return base.answer(request, i);
    });
    const events: RuntimeEvent[] = [];
    const result = await runThread({
      task: "Greet Shoji",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
      steering: box,
    });
    expect(result.status).toBe("ready");
    const builder = provider.requests.filter((r) => roleOf(r) === "builder");
    expect(text(builder[1].messages.at(-1)!.content)).toContain("Keep the greeting lowercase");
    expect(events).toContainEqual({ type: "steered", step: "build", said: "Keep the greeting lowercase" });
    expect(result.unheard).toBeUndefined();
  });

  it("keeps a step going when the person wrote as it answered", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const box = new SteerBox();
    const base = team(() => true);
    let said = false;
    const provider = new ScriptedProvider((request, i) => {
      const answer = base.answer(request, i);
      // The builder's final answer, before the person's words have been read.
      if (roleOf(request) === "builder" && answer.stop_reason === "end_turn" && !said) {
        said = true;
        box.add("Also say goodbye");
      }
      return answer;
    });
    await runThread({
      task: "Greet Shoji",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: () => {},
      steering: box,
    });
    // The step answered, then was asked again with the person's words instead of ending.
    const builder = provider.requests.filter((r) => roleOf(r) === "builder");
    expect(builder.some((r) => text(r.messages.at(-1)!.content).includes("Also say goodbye"))).toBe(true);
    expect(builder.length).toBeGreaterThan(2);
  });

  it("tells Plan what was written while Scout read, and hands back what came too late", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const box = new SteerBox();
    const base = team(() => true);
    const provider = new ScriptedProvider((request, i) => {
      const role = roleOf(request);
      if (role === "scout" && i === 0) box.add("Think about Spanish too");
      const answer = base.answer(request, i);
      if (role === "reviewer") box.add("Then push it");
      return answer;
    });
    const result = await runThread({
      task: "Greet Shoji",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: () => {},
      steering: box,
    });
    // Scout read it at its next turn, so Plan doesn't see it twice.
    const scout = provider.requests.filter((r) => roleOf(r) === "scout");
    expect(text(scout[1].messages.at(-1)!.content)).toContain("Think about Spanish too");
    expect(result.unheard).toEqual(["Then push it"]);
  });

  it("lets a question take in what the person adds", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const box = new SteerBox();
    const provider = new ScriptedProvider((_request, i) => {
      if (i === 0) {
        box.add("and in which file?");
        return reply([{ tool: "read_file", input: { path: "src/hello.js" } }]);
      }
      return reply([{ text: "It says hello, in src/hello.js." }]);
    });
    const events: RuntimeEvent[] = [];
    const result = await answerQuestion({
      task: "What does the greeting say?",
      plan: "",
      question: "What does the greeting say?",
      seat: STACKS.balanced.scout,
      provider,
      workspace: new Workspace(root),
      cap: 1,
      emit: (e) => events.push(e),
      steering: box,
    });
    expect(result.status).toBe("answered");
    // A thread that starts with a question has no task or plan to repeat.
    const first = text(provider.requests[0].messages[0].content);
    expect(first).toContain("A question about the project");
    expect(first).not.toContain("Plan:");
    expect(text(provider.requests[1].messages.at(-1)!.content)).toContain("and in which file?");
    expect(events).toContainEqual({ type: "steered", step: "answer", said: "and in which file?" });
  });
});

describe("a quick change", () => {
  it("skips Scout and Plan, then builds, checks and reviews", async () => {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const provider = team(() => true);
    const result = await runThread({
      task: "Greet Shoji",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: () => {},
      quick: true,
    });
    const roles = provider.requests.map(roleOf);
    expect(roles).not.toContain("scout");
    expect(roles).not.toContain("planner");
    expect(roles).toContain("builder");
    expect(roles).toContain("reviewer");
    expect(result.status).toBe("ready");
    expect(result.plan).toBe(QUICK_PLAN);
  });
});
