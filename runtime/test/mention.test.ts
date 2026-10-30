// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mentionedFiles, runThread } from "../src/pipeline";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, roleOf, team, tempRepo } from "./helpers";

describe("files the person mentions with @", () => {
  it("are read from the task, without trailing punctuation or email addresses", () => {
    expect(mentionedFiles("Use @src/app.ts, like @lib/util.js. Mail me@example.com @src/app.ts")).toEqual([
      "src/app.ts",
      "lib/util.js",
    ]);
    expect(mentionedFiles("(@README.md)")).toEqual(["README.md"]);
    expect(mentionedFiles("a@b.c")).toEqual([]);
  });

  it("go to the planner in full, except a private one", async () => {
    const root = tempRepo({
      "src/hello.js": "export default 'hello';\n",
      "src/style.css": ".greeting { color: red; }\n",
      ".env": "TOKEN=secret-value\n",
    });
    const provider = team(() => true);
    await runThread({
      task: "Make the greeting say hello to Shoji, styled like @src/style.css and using @.env",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(root, [".env"]),
      checks: [CHECK],
      cap: 1,
      emit: () => {},
    });
    const plan = JSON.stringify(provider.requests.find((r) => roleOf(r) === "planner")!.messages[0]);
    expect(plan).toContain("--- src/style.css\\n.greeting { color: red; }");
    expect(plan).toContain("--- src/hello.js");
    expect(plan).not.toContain("secret-value");
  });
});
