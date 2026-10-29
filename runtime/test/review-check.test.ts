import { describe, expect, it } from "vitest";
import { CASES } from "../eval/cases";
import { diffFor, reviewCheck, summary } from "../eval/review-check";
import { Meter } from "../src/meter";
import { STACKS } from "../src/stack";
import { reply, ScriptedProvider } from "./helpers";

// Each case builds a small git repo to diff, and spawning git is slow on Windows runners.
const GIT_TIMEOUT = 30_000;

describe("review check", () => {
  it("plants each bug in the diff the reviewer sees", () => {
    for (const c of CASES) {
      const diff = diffFor(c);
      expect(diff, c.name).toMatch(/^diff --git/);
      expect(diff, c.name).toContain("\n+  ");
    }
    expect(diffFor(CASES[0])).toContain("+  return plan.monthly * 12 * 0.2;");
    // The reviewer can see that the save is async.
    expect(diffFor(CASES[4])).toContain("export async function saveProfile");
  }, GIT_TIMEOUT);

  it("scores a review right only when it names the planted bug or approves a correct change", async () => {
    const cases = [CASES[0], CASES[2], CASES[5]];
    const answers = [
      "VERDICT: FIX\n1. 20% off means multiplying by 0.8, not 0.2.",
      "VERDICT: FIX\n1. Add a test.",
      "VERDICT: APPROVE",
    ];
    const provider = new ScriptedProvider((_, i) => reply([{ text: answers[i] }]));
    const verdicts = await reviewCheck(new Meter(provider, () => {}, 1), STACKS.balanced.review, 1, cases);

    expect(verdicts.map((v) => [v.case, v.right])).toEqual([
      ["annual price", true],
      ["member discount", false],
      ["annual price, correct", true],
    ]);
    expect(provider.requests[0].model).toBe("claude-haiku-5-5");
    expect(provider.requests[0].messages[0].content).toContain("pnpm test: passed");
    expect(summary(verdicts)).toContain("Planted bugs named: 1 of 2");
  }, GIT_TIMEOUT);
});
