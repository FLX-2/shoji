// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STACKS } from "../src/stack";
import { describeBriefing, removeCopy, runTrial, scratchCopy, type TrialEvent } from "../src/trial";
import { CHECK, roleOf, team, tempRepo } from "./helpers";

/** A project whose first commit is where the task started, with the accepted work committed on top. */
function project() {
  const root = tempRepo({ "src/hello.js": "export default 'hello';\n" });
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
  const base = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(root, "src/hello.js"), "export default 'hello, shoji';\n");
  git("-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "Accepted work");
  return { root, base, commit: git("rev-parse", "HEAD"), git };
}

const TASK = "Make the greeting say hello to Shoji.";

describe("trials", () => {
  it("replays each task from its starting commit on the candidate stack, leaving the project alone", async () => {
    const { root, commit, git } = project();
    const provider = team(() => true);
    const events: TrialEvent[] = [];
    const candidate = { ...STACKS.balanced, review: STACKS.opus.review };
    const briefing = await runTrial({
      root,
      tasks: [
        { task: TASK, commit, was: 0.05 },
        { task: TASK, commit, was: 0.07 },
      ],
      stack: candidate,
      provider,
      cap: 1,
      checks: () => [CHECK],
      emit: (e) => events.push(e),
    });

    expect(briefing.outcomes.map((o) => [o.status, o.checksPassed, o.approved])).toEqual([
      ["ready", true, true],
      ["ready", true, true],
    ]);
    expect(briefing.was).toBeCloseTo(0.12);
    // Each outcome carries the candidate's work and the accepted commit's, to set side by side.
    expect(briefing.outcomes[0].diff).toContain("+export default 'hello, shoji';");
    expect(briefing.outcomes[0].accepted).toContain("-export default 'hello';");
    expect(briefing.outcomes[0].accepted).toContain("+export default 'hello, shoji';");
    expect(briefing.cost).toBeCloseTo(briefing.outcomes[0].cost + briefing.outcomes[1].cost);
    // The review ran on the candidate's model.
    const reviews = provider.requests.filter((r) => roleOf(r) === "reviewer");
    expect(new Set(reviews.map((r) => r.model))).toEqual(new Set(["claude-opus-5-5"]));
    // The scout saw the file as it was when the task started.
    const read = events.find((e) => e.type === "runtime" && e.event.type === "tool");
    expect(read).toBeTruthy();
    expect(events.filter((e) => e.type === "task").map((e) => (e.type === "task" ? e.index : -1))).toEqual([0, 1]);
    expect(events[events.length - 1]).toEqual({ type: "briefing", briefing });

    expect(git("status", "--porcelain")).toBe("");
    expect(fs.readFileSync(path.join(root, "src/hello.js"), "utf8")).toBe("export default 'hello, shoji';\n");
  });

  it("records what the checks and the review said when the candidate falls short", async () => {
    const { root, commit } = project();
    const briefing = await runTrial({
      root,
      tasks: [{ task: TASK, commit, was: 0.05 }],
      stack: STACKS.haiku,
      provider: team(() => false, "VERDICT: CHANGES\nThe greeting is unchanged."),
      cap: 1,
      checks: () => [CHECK],
      emit: () => {},
    });
    expect(briefing.outcomes[0]).toMatchObject({
      status: "needs-work",
      checksPassed: false,
      approved: false,
      diff: "",
    });
    expect(briefing.outcomes[0].accepted).toContain("+export default 'hello, shoji';");
    expect(describeBriefing(briefing)).toContain("The review approved 0 of 1.");
    expect(describeBriefing(briefing)).toContain("The 1 that finished cost");
  });

  it("stops at the trial's cap and says how many tasks it skipped", async () => {
    const { root, commit } = project();
    const briefing = await runTrial({
      root,
      tasks: [0, 1, 2].map(() => ({ task: TASK, commit, was: 0.05 })),
      stack: STACKS.balanced,
      provider: team(() => true),
      cap: 0.02,
      checks: () => [CHECK],
      emit: () => {},
    });
    expect(briefing.outcomes.map((o) => o.status)).toEqual(["stopped"]);
    expect(briefing.skipped).toBe(2);
    expect(briefing.cost).toBeLessThanOrEqual(0.02);
    expect(describeBriefing(briefing)).toContain("2 skipped when the cap ran out");
  });

  it("fails a task whose starting commit is gone, and goes on to the next", async () => {
    const { root, commit } = project();
    const briefing = await runTrial({
      root,
      tasks: [
        { task: TASK, commit: "0".repeat(40), was: 0.05 },
        { task: TASK, commit, was: 0.05 },
      ],
      stack: STACKS.balanced,
      provider: team(() => true),
      cap: 1,
      checks: () => [CHECK],
      emit: () => {},
    });
    expect(briefing.outcomes[0]).toMatchObject({ status: "failed", cost: 0, checksPassed: false, accepted: "" });
    expect(briefing.outcomes[0].reason).toMatch(/isn't in the project any more/);
    expect(briefing.outcomes[1].status).toBe("ready");
  });

  it("lends a copy the project's packages without putting them in its diff, and never deletes them", () => {
    const { root, base } = project();
    fs.mkdirSync(path.join(root, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/x/index.js"), "");
    const copy = scratchCopy(root, base);
    expect(fs.existsSync(path.join(copy, "node_modules/x/index.js"))).toBe(true);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: copy, encoding: "utf8" }).stdout;
    expect(status).toBe("");
    // Git on Windows may check the copy out with CRLF line endings.
    expect(fs.readFileSync(path.join(copy, "src/hello.js"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "export default 'hello';\n",
    );
    removeCopy(copy);
    expect(fs.existsSync(copy)).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules/x/index.js"))).toBe(true);
  });
});
