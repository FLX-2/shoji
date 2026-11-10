// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Comparison } from "../src/compare";
import type { RuntimeEvent } from "../src/events";
import { holdToLook, lookBlocks, lookScore } from "../src/look";
import { runThread } from "../src/pipeline";
import { NO_PREVIEW, type Preview } from "../src/preview";
import type { ModelRequest } from "../src/provider";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, tempRepo } from "./helpers";

/** A tiny PNG file, as the shots on disk would be. */
function shot(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from("iVBORw0KGgo=", "base64"));
  return file;
}

function comparison(dir: string): Comparison {
  return {
    pages: [
      {
        path: "/pricing",
        shots: [360, 768, 1280].map((width) => ({
          width,
          before: shot(dir, `before-${width}.png`),
          after: shot(dir, `after-${width}.png`),
        })),
      },
    ],
  };
}

const images = (request: ModelRequest) => {
  const content = request.messages[0].content;
  return Array.isArray(content) ? content.filter((b) => b.type === "image").length : 0;
};

describe("the review's look score", () => {
  it("reads the score on the LOOK line", () => {
    expect(lookScore("VERDICT: APPROVE\nLOOK: 8/10\nFine.")).toBe(8);
    expect(lookScore("VERDICT: FIX\nLOOK: 6.5 out of 10")).toBe(6.5);
    expect(lookScore("VERDICT: APPROVE")).toBeUndefined();
    expect(lookScore("VERDICT: APPROVE\nLOOK: 12/10")).toBeUndefined();
  });

  it("turns an approval with a look under 8 into a request for fixes", () => {
    expect(holdToLook("VERDICT: APPROVE\nLOOK: 6/10\n1. The card overlaps at 360px.")).toBe(
      "VERDICT: FIX\nLOOK: 6/10\n1. The card overlaps at 360px.",
    );
    expect(holdToLook("VERDICT: APPROVE\nLOOK: 8/10")).toBe("VERDICT: APPROVE\nLOOK: 8/10");
    expect(holdToLook("VERDICT: APPROVE")).toBe("VERDICT: APPROVE");
  });

  it("shows Review each page before and after at the narrowest and widest widths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-look-"));
    const blocks = lookBlocks(comparison(dir));
    const labels = blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
    expect(labels).toEqual([
      "/pricing at 360px, before the change:",
      "/pricing at 360px, after the change:",
      "/pricing at 1280px, before the change:",
      "/pricing at 1280px, after the change:",
    ]);
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(4);
    expect(lookBlocks({ pages: [] })).toEqual([]);
  });
});

describe("a thread whose review judges the look", () => {
  /** A team whose builder writes the greeting and looks at /pricing, and whose reviewer answers `verdicts` in turn. */
  function lookingTeam(verdicts: string[]) {
    let reviews = 0;
    return new ScriptedProvider((request) => {
      const last = request.messages[request.messages.length - 1];
      const answered = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
      switch (roleOf(request)) {
        case "scout":
          return reply([{ text: "src/hello.js\nFILES: src/hello.js" }]);
        case "planner":
          return reply([{ text: "Change the greeting." }]);
        case "builder":
          return answered
            ? reply([{ text: "Changed the greeting." }])
            : reply([{ tool: "write_file", input: { path: "src/hello.js", content: "export default 'hello, shoji';\n" } }]);
        default:
          return reply([{ text: verdicts[Math.min(reviews++, verdicts.length - 1)] }]);
      }
    });
  }

  async function run(provider: ScriptedProvider, withLook: boolean) {
    const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-look-"));
    const preview: Preview = { ...NO_PREVIEW, looked: () => ["/pricing"] };
    let taken = 0;
    const events: RuntimeEvent[] = [];
    const result = await runThread({
      task: "Say hello to Shoji on the pricing page",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
      preview,
      ...(withLook && {
        look: async () => {
          taken++;
          return comparison(dir);
        },
      }),
    });
    return { result, events, taken: () => taken };
  }

  it("shows Review the pages and approves a look at the bar", async () => {
    const provider = lookingTeam(["VERDICT: APPROVE\nLOOK: 9/10"]);
    const { result, taken } = await run(provider, true);

    expect(result.status).toBe("ready");
    const review = provider.requests.find((r) => roleOf(r) === "reviewer")!;
    expect(images(review)).toBe(4);
    expect(JSON.stringify(review.messages[0].content)).toContain("before the change and after it");
    expect(review.system).toContain("LOOK: 8/10");
    expect(taken()).toBe(1);
  });

  it("sends a look under the bar back to Build, then reviews the pages again", async () => {
    const provider = lookingTeam([
      "VERDICT: APPROVE\nLOOK: 6/10\n1. The price wraps at 360px.",
      "VERDICT: APPROVE\nLOOK: 8/10",
    ]);
    const { result, events, taken } = await run(provider, true);

    expect(result.status).toBe("ready");
    const outputs = events.flatMap((e) => (e.type === "step" && e.status === "done" && e.step === "review" ? [e.output] : []));
    expect(outputs[0]).toMatch(/^VERDICT: FIX\nLOOK: 6\/10/);
    const fix = provider.requests.filter((r) => roleOf(r) === "builder").at(-2)!;
    expect(JSON.stringify(fix.messages[0].content)).toContain("The price wraps at 360px.");
    expect(taken()).toBe(2);
  });

  it("keeps the review to the diff when the look isn't asked for", async () => {
    const provider = lookingTeam(["VERDICT: APPROVE"]);
    const { result } = await run(provider, false);

    expect(result.status).toBe("ready");
    expect(images(provider.requests.find((r) => roleOf(r) === "reviewer")!)).toBe(0);
  });
});
