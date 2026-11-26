import { describe, expect, it } from "vitest";
import type { RuntimeEvent, ThreadResult } from "../../runtime/src/events";
import type { LedgerThread } from "../bridge";
import type { Thread } from "../thread/useThread";
import { changedFiles, prBody } from "./prBody";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const diff = (...files: [string, "new" | "removed" | "changed"][]) =>
  files
    .map(
      ([path, how]) =>
        `diff --git a/${path} b/${path}\n${how === "new" ? "new file mode 100644\n" : how === "removed" ? "deleted file mode 100644\n" : ""}--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`,
    )
    .join("");

const ran = (build: string, changed: string, extra: RuntimeEvent[] = []): RuntimeEvent[] => [
  { type: "step", step: "build", role: "build", model: SONNET, status: "running" },
  { type: "step", step: "build", role: "build", model: SONNET, status: "done", output: build },
  ...extra,
  { type: "result", result: { status: "ready", diff: changed } as ThreadResult },
];

const live = (...turns: RuntimeEvent[][]): Thread => ({
  task: "Add an annual toggle to the pricing cards",
  repo: "/work/pricing-page",
  stack: {} as Thread["stack"],
  cap: 1,
  turns: turns.map((events) => ({ ask: "", kind: "task", events })),
});

const call = (step: string, role: string, model: string, cost: number) => ({
  at: 0,
  step,
  role,
  model,
  cost,
  effort: "medium" as const,
  inputTokens: 1000,
  outputTokens: 100,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  seconds: 1,
});

const record = (): LedgerThread =>
  ({
    id: 1,
    task: "Add an annual toggle to the pricing cards",
    repo: "/work/pricing-page",
    branch: "shoji/thread",
    stack: "balanced",
    startedAt: 0,
    committed: "a1b2c3d",
    committedAt: 0,
    runs: [
      {
        id: 1,
        kind: "task",
        startedAt: 0,
        status: "ready",
        calls: [call("plan", "plan", OPUS, 0.1), call("build", "build", SONNET, 0.02), call("review", "review", HAIKU, 0.004)],
      },
    ],
  }) as LedgerThread;

describe("a pull request's description", () => {
  it("leads with what changed and the files, and keeps the cost to one line at the end", () => {
    const thread = live(
      ran(
        "Added a monthly and annual toggle above the pricing cards, with yearly prices shown at a 20% discount.",
        diff(["src/components/BillingToggle.tsx", "new"], ["src/components/PricingCards.tsx", "changed"]),
      ),
    );
    const body = prBody(thread, record(), true)!;
    const lines = body.split("\n");
    expect(lines[0]).toBe(
      "Added a monthly and annual toggle above the pricing cards, with yearly prices shown at a 20% discount.",
    );
    expect(body).toContain(
      ["### Files changed", "", "- `src/components/BillingToggle.tsx` (new)", "- `src/components/PricingCards.tsx`"].join("\n"),
    );
    expect(lines.filter((l) => l.includes("$"))).toHaveLength(1);
    expect(lines.at(-1)).toBe(
      "<sub>$0.124 on Opus 5.5, Sonnet 5.5 and Haiku 5.5 · Review passed · Made with [Shoji](https://shoji-app.vercel.app/)</sub>",
    );
  });

  it("leaves the cost out unless Settings says so, and still says it was made with Shoji", () => {
    const thread = live(ran("Fixed the basket total.", diff(["src/basket.ts", "changed"])));
    expect(prBody(thread, record(), false)).toBe(
      [
        "Fixed the basket total.",
        "",
        "### Files changed",
        "",
        "- `src/basket.ts`",
        "",
        "---",
        "",
        "<sub>Made with [Shoji](https://shoji-app.vercel.app/)</sub>",
      ].join("\n"),
    );
  });

  it("sums up every run that changed the work, and lists each file once, as the last run left it", () => {
    const fixRound: RuntimeEvent[] = [
      { type: "step", step: "fix-1", role: "build", model: SONNET, status: "running" },
      { type: "step", step: "fix-1", role: "build", model: SONNET, status: "done", output: "Fixed the review's note." },
    ];
    const thread = live(
      ran("Added the toggle.", diff(["src/toggle.ts", "new"], ["src/old.ts", "changed"]), fixRound),
      ran("Made the toggle keyboard friendly.", diff(["src/toggle.ts", "changed"], ["src/old.ts", "removed"])),
    );
    const body = prBody(thread, null, true)!;
    // A fix round after a build sums up only the fix, so the build's own words stand for the run.
    expect(body.startsWith("Added the toggle.\n\nMade the toggle keyboard friendly.\n\n### Files changed")).toBe(true);
    expect(changedFiles(thread)).toEqual([{ path: "src/toggle.ts" }, { path: "src/old.ts", how: "removed" }]);
  });

  it("counts the files past thirty, and says nothing when the thread changed nothing", () => {
    const many = Array.from({ length: 45 }, (_, i): [string, "changed"] => [`src/f${i}.ts`, "changed"]);
    const body = prBody(live(ran("Renamed the helpers.", diff(...many))), null, false)!;
    expect(body.split("\n").filter((l) => l.startsWith("- `"))).toHaveLength(30);
    expect(body).toContain("- and 15 more\n");
    expect(prBody(live([]), null, false)).toBeNull();
  });
});
