// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { parseFrontmatter } from "../src/frontmatter";
import { runThread } from "../src/pipeline";
import type { ModelRequest } from "../src/provider";
import { findSkills } from "../src/skills";
import { expandCommand } from "../src/slash";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

const FIX_ISSUE = `---
description: Fix a numbered issue
argument-hint: <number>
---
Fix issue #$ARGUMENTS. Read @src/hello.js first.
`;

/** A home .claude folder of the person's own, with one command and one skill. */
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-home-"));
  fs.mkdirSync(path.join(dir, "commands"));
  fs.writeFileSync(path.join(dir, "commands/tidy.md"), "Tidy up the code.\n");
  fs.writeFileSync(path.join(dir, "commands/fix-issue.md"), "The person's own, which the project's overrides.\n");
  fs.mkdirSync(path.join(dir, "skills/release-notes"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "skills/release-notes/SKILL.md"),
    "---\nname: release-notes\ndescription: >\n  Write release notes\n  in the house style.\n---\nUse past tense.\n",
  );
  return dir;
}

describe("front matter", () => {
  it("reads plain, quoted and folded fields, and leaves the text after it", () => {
    const { fields, body } = parseFrontmatter(
      `---\ndescription: "Ship it"\nargument-hint: [env]\nnotes: |\n  one\n  two\n---\nDo it.\n`,
    );
    expect(fields).toEqual({ description: "Ship it", "argument-hint": "[env]", notes: "one\ntwo" });
    expect(body).toBe("Do it.\n");
    expect(parseFrontmatter("No front matter.").body).toBe("No front matter.");
  });
});

describe("slash commands", () => {
  const project = () =>
    new Workspace(
      tempRepo({
        "src/hello.js": "export default 'hello';\n",
        ".claude/commands/fix-issue.md": FIX_ISSUE,
        ".claude/commands/review/pair.md": "Review $1 against $2.",
        ".claude/commands/secret.md": "Hidden.",
      }),
      [".claude/commands/secret.md"],
    );

  it("turns a command and its arguments into the command's text", () => {
    const workspace = project();
    const mine = home();
    expect(expandCommand("/fix-issue 12", workspace, mine)).toBe("Fix issue #12. Read @src/hello.js first.");
    // Subfolders only sort commands; the name is the file's.
    expect(expandCommand('/pair main "my branch"', workspace, mine)).toBe("Review main against my branch.");
    // The person's own commands work in every project, and arguments go at the end when there's no place for them.
    expect(expandCommand("/tidy src/", workspace, mine)).toBe("Tidy up the code.\n\nARGUMENTS: src/");
  });

  it("leaves text alone when it names no command it can read", () => {
    const workspace = project();
    const mine = home();
    for (const text of ["/etc/hosts is wrong", "/nothing-here", "Fix /fix-issue", "/secret"]) {
      expect(expandCommand(text, workspace, mine)).toBe(text);
    }
  });
});

describe("skills", () => {
  it("lists the project's and the person's skills and reads their files, never outside them", () => {
    const workspace = new Workspace(
      tempRepo({
        ".claude/skills/migrations/SKILL.md": "---\ndescription: Add a database migration\n---\nSee steps.md.\n",
        ".claude/skills/migrations/steps.md": "1. Write it.\n",
        ".claude/skills/migrations/.env": "TOKEN=1\n",
        ".claude/skills/empty/README.md": "Not a skill.\n",
        ".env": "TOKEN=1\n",
      }),
      [".env"],
    );
    const skills = findSkills(workspace, home());
    expect(skills.note).toContain("- migrations: Add a database migration");
    expect(skills.note).toContain("- release-notes: Write release notes in the house style.");
    expect(skills.note).not.toContain("empty");
    expect(skills.read("migrations", "SKILL.md")).toContain("See steps.md.");
    expect(skills.read("migrations", "steps.md")).toBe("1. Write it.\n");
    expect(skills.read("release-notes", "SKILL.md")).toContain("Use past tense.");
    expect(skills.read("migrations", "../../../.env")).toMatch(/outside the skill's folder/);
    expect(skills.read("migrations", ".env")).toMatch(/private/);
    expect(skills.read("migrations", "nope.md")).toBe("Error: the migrations skill has no nope.md.");
    expect(skills.read("deploy", "SKILL.md")).toBe("Error: there is no skill called deploy.");
  });

  it("offers nothing when there are none", () => {
    const skills = findSkills(new Workspace(tempRepo({ "a.txt": "a" })), home() + "-missing");
    expect(skills.note).toBe("");
    expect(skills.tools).toEqual([]);
  });
});

describe("a thread started with a command and given skills", () => {
  it("works from the command's text, and Build reads a skill when it needs one", async () => {
    const scripted = team(() => true);
    const results = (r: ModelRequest) => r.messages.filter((m) => m.role === "user" && Array.isArray(m.content)).length;
    const provider = new ScriptedProvider((request, index) => {
      if (roleOf(request) === "builder" && results(request) === 0) {
        return reply([{ tool: "read_skill", input: { name: "greetings", file: "SKILL.md" } }]);
      }
      return scripted.answer(request, index);
    });
    const events: RuntimeEvent[] = [];
    const result = await runThread({
      task: "/greet Shoji",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(
        tempRepo({
          "src/hello.js": "export default 'hello';\n",
          ".claude/commands/greet.md": "Make the greeting say hello to $ARGUMENTS.",
          ".claude/skills/greetings/SKILL.md": "---\ndescription: How greetings are written\n---\nLower case.\n",
        }),
      ),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
    });
    expect(result.status).toBe("ready");
    const first = (role: string) => provider.requests.find((r) => roleOf(r) === role)!;
    const prompt = (r: ModelRequest) => JSON.stringify(r.messages[0].content);
    expect(prompt(first("scout"))).toContain("Task: Make the greeting say hello to Shoji.");
    expect(prompt(first("scout"))).toContain("- greetings: How greetings are written");
    expect(prompt(first("planner"))).toContain("Task: Make the greeting say hello to Shoji.");
    expect(first("builder").tools?.map((t) => t.name)).toContain("read_skill");
    expect(events).toContainEqual({ type: "tool", step: "build", tool: "read_skill", target: "greetings" });
    const skillResult = provider.requests
      .filter((r) => roleOf(r) === "builder")
      .flatMap((r) => r.messages)
      .find((m) => JSON.stringify(m.content).includes("Lower case."));
    expect(skillResult).toBeTruthy();
  });
});
