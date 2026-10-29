// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasChanges } from "../src/git";
import { runThread } from "../src/pipeline";
import { writeNotes, type NotesEvent } from "../src/notes";
import { STACKS } from "../src/stack";
import { removeCopy, scratchCopy } from "../src/trial";
import { Workspace } from "../src/workspace";
import { reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

const NOTES = "# Greeter\n\nRun `npm test` before every change.";

/** A scout that reads package.json once, then answers with the notes. */
function scout() {
  return new ScriptedProvider((request) => {
    const last = request.messages[request.messages.length - 1];
    const answered = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
    return answered ? reply([{ text: NOTES }]) : reply([{ tool: "read_file", input: { path: "package.json" } }]);
  });
}

const project = () =>
  tempRepo({ "package.json": '{"scripts":{"test":"node test.js"}}\n', "src/hello.js": "export default 'hello';\n" });

describe("project notes", () => {
  it("has the scout seat write SHOJI.md, which git ignores", async () => {
    const root = project();
    const provider = scout();
    const events: NotesEvent[] = [];
    const result = await writeNotes({
      root,
      seat: STACKS.balanced.scout,
      provider,
      cap: 0.05,
      emit: (e) => events.push(e),
    });

    expect(result.status).toBe("ready");
    expect(result.cost).toBeGreaterThan(0);
    const written = fs.readFileSync(path.join(root, "SHOJI.md"), "utf8");
    expect(written).toContain(NOTES);
    // It ran on the scout's model with read-only tools.
    expect(new Set(provider.requests.map((r) => r.model))).toEqual(new Set([STACKS.balanced.scout.model]));
    expect(roleOf(provider.requests[0])).toBe("scout");
    expect(provider.requests[0].tools!.map((t) => t.name)).toEqual(["list_files", "read_file", "search"]);
    // The project still looks unchanged, so threads can start and commits leave the notes out.
    expect(hasChanges(root)).toBe(false);
    expect(events.filter((e) => e.type === "call")).toHaveLength(2);
    expect(events[events.length - 1]).toEqual({ type: "notes", result });

    // A second run keeps the notes and makes no call.
    fs.writeFileSync(path.join(root, "SHOJI.md"), "Edited by hand.\n");
    const again = await writeNotes({ root, seat: STACKS.balanced.scout, provider: scout(), cap: 0.05, emit: () => {} });
    expect(again).toEqual({ status: "kept", notes: "Edited by hand.\n", cost: 0 });
    const exclude = fs.readFileSync(path.join(root, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((l) => l === "/SHOJI.md")).toHaveLength(1);
  });

  it("stops before a call could pass the cap, and writes nothing", async () => {
    const root = project();
    const result = await writeNotes({
      root,
      seat: STACKS.balanced.scout,
      provider: scout(),
      cap: 0.001,
      emit: () => {},
    });
    expect(result.status).toBe("stopped");
    expect(result.reason).toMatch(/limit/);
    expect(fs.existsSync(path.join(root, "SHOJI.md"))).toBe(false);
  });

  it("fails without writing when the scout doesn't finish", async () => {
    const root = project();
    const looping = new ScriptedProvider(() => reply([{ tool: "list_files", input: { path: "." } }]));
    const result = await writeNotes({ root, seat: STACKS.balanced.scout, provider: looping, cap: 1, emit: () => {} });
    expect(result.status).toBe("failed");
    expect(fs.existsSync(path.join(root, "SHOJI.md"))).toBe(false);
  });

  it("reaches Plan in the project and in a trial's copy of it", async () => {
    const root = project();
    fs.writeFileSync(path.join(root, "SHOJI.md"), NOTES);
    const copy = scratchCopy(root, "HEAD");
    try {
      expect(fs.readFileSync(path.join(copy, "SHOJI.md"), "utf8")).toBe(NOTES);
      expect(hasChanges(copy)).toBe(false);
      const provider = team(() => true);
      await runThread({
        task: "Greet Shoji.",
        stack: STACKS.balanced,
        provider,
        workspace: new Workspace(copy),
        checks: [],
        cap: 1,
        emit: () => {},
      });
      const plan = provider.requests.find((r) => roleOf(r) === "planner")!;
      expect(JSON.stringify(plan.messages)).toContain("Run `npm test` before every change.");
    } finally {
      removeCopy(copy);
    }
  });
});
