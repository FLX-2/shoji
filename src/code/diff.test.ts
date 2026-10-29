import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";

const DIFF = `diff --git a/src/Card.tsx b/src/Card.tsx
index 1111111..2222222 100644
--- a/src/Card.tsx
+++ b/src/Card.tsx
@@ -17,4 +17,5 @@ export function Card() {
 export function PricingCard({ plan }) {
-  const price = plan.monthly;
+  const price = billing === "annual" ? plan.annual / 12 : plan.monthly;
+  // The badge sits above the price below 400px.
   return price;
diff --git a/src/my file.ts b/src/my file.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/my file.ts
@@ -0,0 +1 @@
+export const billing = "monthly";
\\ No newline at end of file
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parsing a diff", () => {
  const files = parseDiff(DIFF);

  it("finds each file with its status and counts", () => {
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
      ["src/Card.tsx", "modified", 2, 1, false],
      ["src/my file.ts", "added", 1, 0, false],
      ["logo.png", "modified", 0, 0, true],
    ]);
  });

  it("numbers lines on both sides of the change", () => {
    const [hunk] = files[0].hunks;
    expect(hunk.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ["ctx", 17, 17],
      ["del", 18, undefined],
      ["add", undefined, 18],
      ["add", undefined, 19],
      ["ctx", 19, 20],
    ]);
    expect(files[1].hunks[0].lines).toEqual([{ kind: "add", new: 1, text: 'export const billing = "monthly";' }]);
  });

  it("reads an empty diff as no files", () => {
    expect(parseDiff("")).toEqual([]);
  });
});
