// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { runThread } from "../src/pipeline";
import { LEAD } from "../src/prompts";
import type { ModelRequest } from "../src/provider";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

type Turn = { tool: string; input: Record<string, string> } | { text: string };

/** A lead that takes its turns from a script, with the scripted team answering for every seat it calls. */
function led(turns: Turn[]) {
  const seats = team(() => true);
  let leadTurn = 0;
  return new ScriptedProvider((request, index) => {
    if (request.system !== LEAD) return seats.answer(request, index);
    return reply([turns[Math.min(leadTurn++, turns.length - 1)]]);
  });
}

const leads = (r: ModelRequest) => r.system === LEAD;
const seatOf = (r: ModelRequest) => (leads(r) ? "lead" : roleOf(r));

async function run(provider: ScriptedProvider) {
  const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
  const events: RuntimeEvent[] = [];
  const result = await runThread({
    task: "Greet Shoji",
    stack: STACKS.balanced,
    provider,
    workspace: new Workspace(root),
    checks: [CHECK],
    cap: 1,
    emit: (e) => events.push(e),
    lead: true,
  });
  return { result, events, seats: provider.requests.map(seatOf) };
}

describe("a led run", () => {
  it("runs the lead on the Scout seat's model, as its own step", async () => {
    const { events, seats } = await run(led([{ text: "Nothing to change." }]));
    expect(seats).toEqual(["lead"]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "step", step: "lead", role: "scout", model: STACKS.balanced.scout.model }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "call", call: expect.objectContaining({ step: "lead" }) }));
  });

  it("can skip Scout and Plan, but still checks and reviews what it built", async () => {
    const { result, seats } = await run(
      led([{ tool: "build", input: { instructions: "Make the greeting 'hello, shoji'." } }, { text: "Changed it." }]),
    );
    expect(seats).not.toContain("planner");
    expect(seats).not.toContain("scout");
    expect(seats.at(-1)).toBe("reviewer");
    expect(result.checks.map((c) => c.ok)).toEqual([true]);
    expect(result.status).toBe("ready");
    // Work built from instructions alone carries them on as its plan.
    expect(result.plan).toBe("Make the greeting 'hello, shoji'.");
  });

  it("doesn't review twice when the lead already reviewed the latest build", async () => {
    const { result, seats } = await run(
      led([
        { tool: "build", input: { instructions: "Make the greeting 'hello, shoji'." } },
        { tool: "check", input: {} },
        { tool: "review", input: {} },
        { text: "Changed it; checks and review passed." },
      ]),
    );
    expect(seats.filter((s) => s === "reviewer")).toHaveLength(1);
    expect(seats.at(-1)).toBe("lead");
    expect(result.status).toBe("ready");
  });

  it("reviews again when the lead built after its last review", async () => {
    const { seats } = await run(
      led([
        { tool: "build", input: { instructions: "Make the greeting 'hello, shoji'." } },
        { tool: "review", input: {} },
        { tool: "build", input: { instructions: "Tidy the greeting." } },
        { text: "Done." },
      ]),
    );
    expect(seats.filter((s) => s === "reviewer")).toHaveLength(2);
    expect(seats.at(-1)).toBe("reviewer");
  });

  it("answers a question with the scout and changes nothing", async () => {
    const { result, events, seats } = await run(
      led([{ tool: "scout", input: { question: "Where is the greeting?" } }, { text: "It's in src/hello.js." }]),
    );
    expect(seats).not.toContain("builder");
    expect(seats).not.toContain("reviewer");
    expect(result.status).toBe("answered");
    expect(result.diff).toBe("");
    expect(events).toContainEqual(expect.objectContaining({ type: "step", step: "answer", status: "done", output: "It's in src/hello.js." }));
  });
});
