import { describe, expect, it } from "vitest";
import { highlight, languageOf } from "./syntax";

const kinds = (line: string, language: string | null) =>
  highlight(line, language)
    .filter((p) => p.kind !== "plain")
    .map((p) => `${p.kind}:${p.text}`);

describe("colouring code", () => {
  it("knows a file's language by its name", () => {
    expect(languageOf("src/App.tsx")).toBe("js");
    expect(languageOf("src-tauri/src/push.rs")).toBe("rust");
    expect(languageOf("README.md")).toBeNull();
  });

  it("finds keywords, strings, numbers and comments, and keeps every character", () => {
    const line = `  const price = billing === "annual" ? plan.annual / 12 : plan.monthly; // per month`;
    expect(kinds(line, "js")).toEqual(["keyword:const", 'string:"annual"', "number:12", "comment:// per month"]);
    expect(
      highlight(line, "js")
        .map((p) => p.text)
        .join(""),
    ).toBe(line);
  });

  it("leaves words that only contain a keyword, escaped quotes and other languages alone", () => {
    expect(kinds("const constant = importer;", "js")).toEqual(["keyword:const"]);
    expect(kinds(`let s = "say \\"if\\" then";`, "js")).toEqual(["keyword:let", `string:"say \\"if\\" then"`]);
    expect(kinds("x2 = a1", "js")).toEqual([]);
    expect(kinds("const x = 1", null)).toEqual([]);
  });

  it("knows each language's own words and comments", () => {
    expect(kinds("pub fn push(repo: &str) -> Result<(), String> { /* go */", "rust")).toEqual([
      "keyword:pub",
      "keyword:fn",
      "comment:/* go */",
    ]);
    expect(kinds("def look(self): # once", "python")).toEqual(["keyword:def", "comment:# once"]);
    expect(kinds("  margin-top: 4px !important;", "css")).toEqual(["number:4", "keyword:!important"]);
  });
});
