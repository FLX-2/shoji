import { describe, expect, it } from "vitest";
import { parseBlocks } from "./Markdown";

describe("reading a model's markdown", () => {
  it("finds headings, paragraphs, lists, code and rules", () => {
    expect(parseBlocks("# Plan\nFirst line\nsecond line\n\n- one\n- two\n\n```\nnpm test\n```\n---\n> a note")).toEqual(
      [
        { type: "heading", level: 1, text: "Plan" },
        { type: "paragraph", lines: ["First line", "second line"] },
        { type: "list", ordered: false, start: 1, items: [{ lines: ["one"] }, { lines: ["two"] }] },
        { type: "code", text: "npm test" },
        { type: "rule" },
        { type: "quote", lines: ["a note"] },
      ],
    );
  });

  it("keeps numbering, nests indented lists and carries wrapped lines on", () => {
    const [list] = parseBlocks("3. Add the toggle\n   so it shows\n   - in the card\n4. Test it");
    expect(list).toEqual({
      type: "list",
      ordered: true,
      start: 3,
      items: [
        {
          lines: ["Add the toggle", "so it shows"],
          sub: { type: "list", ordered: false, start: 1, items: [{ lines: ["in the card"] }] },
        },
        { lines: ["Test it"] },
      ],
    });
  });

  it("keeps a list going across blank lines between its items", () => {
    const blocks = parseBlocks("1. One\n\n2. Two\n\nAfter");
    expect(blocks.map((b) => b.type)).toEqual(["list", "paragraph"]);
  });
});
