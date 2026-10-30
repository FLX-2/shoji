// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAttachments, withAttachments } from "../src/attachments";
import { runThread } from "../src/pipeline";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, roleOf, team, tempRepo } from "./helpers";

function files(entries: Record<string, string | Buffer>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-attach-"));
  return Object.entries(entries).map(([name, content]) => {
    fs.writeFileSync(path.join(dir, name), content);
    return path.join(dir, name);
  });
}

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

describe("attachments", () => {
  it("sends screenshots as images, PDFs as documents and anything else as text", () => {
    const { names, blocks } = readAttachments(
      files({ "Pricing.PNG": PNG, "brief.pdf": "%PDF-1.4", "notes.md": "Keep the toggle **small**." }),
    );
    expect(names).toEqual(["Pricing.PNG", "brief.pdf", "notes.md"]);
    expect(blocks).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.4").toString("base64") } },
      { type: "text", text: "Attached file notes.md:\nKeep the toggle **small**." },
    ]);
  });

  it("names the file it can't send", () => {
    expect(() => readAttachments(files({ "app.exe": Buffer.from([77, 90, 0, 1]) }))).toThrow(
      "app.exe isn't a screenshot, PDF or text file",
    );
    expect(() => readAttachments(files({ "huge.png": Buffer.alloc(5 * 1024 * 1024 + 1) }))).toThrow("huge.png is over 5 MB");
    expect(() => readAttachments(["/no/such/shot.png"])).toThrow("couldn't read the attached file shot.png");
  });

  it("cuts a long text file", () => {
    const { blocks } = readAttachments(files({ "log.txt": "x".repeat(40_010) }));
    expect(blocks[0]).toMatchObject({ text: expect.stringContaining("(cut here, 10 more characters)") });
  });

  it("leaves a prompt as text when nothing is attached", () => {
    expect(withAttachments("Task: x")).toBe("Task: x");
  });

  it("puts what the person attached in front of every role", async () => {
    const provider = team(() => true);
    const attachments = readAttachments(files({ "mock.png": PNG }));
    const result = await runThread({
      task: "Make the greeting say hello to Shoji, like the mock.",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(tempRepo({ "src/hello.js": "export default 'hello';\n" })),
      checks: [CHECK],
      cap: 1,
      attachments,
      emit: () => {},
    });

    expect(result.status).toBe("ready");
    const firsts = new Map(provider.requests.map((r) => [roleOf(r), r.messages[0].content]));
    expect([...firsts.keys()].sort()).toEqual(["builder", "planner", "reviewer", "scout"]);
    for (const content of firsts.values()) {
      expect(Array.isArray(content) && content[0]).toMatchObject({ type: "image" });
      expect(Array.isArray(content) && content.at(-1)).toMatchObject({
        type: "text",
        text: expect.stringContaining("The person attached mock.png, shown above."),
      });
    }
  });
});
