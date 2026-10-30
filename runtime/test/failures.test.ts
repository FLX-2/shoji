// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failingIn } from "../src/failures";

describe("failingIn", () => {
  it("reads Vitest's failing files and tests", () => {
    const output = [
      " FAIL  src/Settings.test.tsx [ src/Settings.test.tsx ]",
      "Error: Failed to resolve import \"../../store/useSettingsStore\"",
      " FAIL  src/theme.test.ts > ThemeProvider > applies midnight",
      " ✓ src/other.test.ts (3 tests) 12ms",
    ].join("\n");
    expect(failingIn(output)).toEqual(["FAIL src/Settings.test.tsx", "FAIL src/theme.test.ts > ThemeProvider > applies midnight"]);
  });

  it("reads Jest, pytest, cargo, go and tsc, and leaves Jest's console out", () => {
    const output = [
      "FAIL src/a.test.js (5.2 s)",
      "  ● greeting › says hello",
      "  ● Console",
      "FAILED tests/test_a.py::test_b - AssertionError: 1 != 2",
      "test parser::reads_flags ... FAILED",
      "--- FAIL: TestRoutes (0.00s)",
      "src/app.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/b.ts:3:1 - error TS2304: Cannot find name 'x'.",
    ].join("\n");
    expect(failingIn(output)).toEqual([
      "FAIL src/a.test.js",
      "● greeting › says hello",
      "FAILED tests/test_a.py::test_b",
      "test parser::reads_flags",
      "--- FAIL: TestRoutes",
      "src/app.ts TS2322",
      "src/b.ts TS2304",
    ]);
  });

  it("finds nothing in output it can't read", () => {
    expect(failingIn("Error: something broke\n    at main (index.js:3:9)")).toEqual([]);
  });
});
