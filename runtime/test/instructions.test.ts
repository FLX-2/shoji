// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectInstructions } from "../src/instructions";
import { runThread } from "../src/pipeline";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, roleOf, team, tempRepo } from "./helpers";

describe("the project's instructions", () => {
  it("go to Plan, Build and Review, but not Scout", async () => {
    const root = tempRepo({
      "src/hello.js": "export default 'hello';\n",
      "AGENTS.md": "Use tabs.\n",
      "CLAUDE.md": "Never add new colours.\n",
      "SHOJI.md": "A tiny greeting project.\n",
    });
    const provider = team(() => true);
    const result = await runThread({
      task: "Make the greeting say hello to Shoji.",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root),
      checks: [CHECK],
      cap: 1,
      emit: () => {},
    });
    expect(result.status).toBe("ready");

    const first = (role: string) => JSON.stringify(provider.requests.find((r) => roleOf(r) === role)!.messages[0]);
    for (const role of ["planner", "builder", "reviewer"]) {
      expect(first(role)).toContain("The project's instructions (AGENTS.md):\\nUse tabs.");
      expect(first(role)).toContain("The project's instructions (CLAUDE.md):\\nNever add new colours.");
    }
    expect(first("planner")).toContain("Project notes (SHOJI.md):\\nA tiny greeting project.");
    expect(first("scout")).not.toContain("instructions");
  });

  it("leave out a file the person keeps private, an empty one, and the length past the limit", () => {
    const root = tempRepo({ "AGENTS.md": "  \n", "CLAUDE.md": `${"x".repeat(25_000)}` });
    const long = projectInstructions(new Workspace(root));
    expect(long).not.toContain("AGENTS.md");
    expect(long).toContain("(The rest of CLAUDE.md was cut for length.)");
    expect(long.length).toBeLessThan(21_000);

    expect(projectInstructions(new Workspace(root, ["CLAUDE.md"]))).toBe("");
    expect(projectInstructions(new Workspace(tempRepo({})))).toBe("");
  });
});
