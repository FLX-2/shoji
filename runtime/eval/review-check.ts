// The review check: does the review seat catch bugs that the checks miss?
// pnpm review-check --model claude-haiku-5-5 --trials 3 --cap 0.10 --out runtime/eval/results/haiku-low.json
// It calls a model, so it never runs in the tests. Its recorded results are kept in eval/results.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { MAX_TOKENS, textOf } from "../src/agent";
import { diffOf } from "../src/git";
import { BudgetExceeded, Meter } from "../src/meter";
import { MODELS, type ModelId } from "../src/models";
import { approves, reviewPrompt } from "../src/pipeline";
import * as prompts from "../src/prompts";
import { AnthropicProvider, type ModelProvider } from "../src/provider";
import type { Seat } from "../src/stack";
import { CASES, type ReviewCase } from "./cases";

export interface Verdict {
  case: string;
  planted: boolean;
  approved: boolean;
  /** For a planted bug: the review asked for fixes and named the bug. */
  named: boolean;
  /** Right means a planted bug was named, or a control was approved. */
  right: boolean;
  review: string;
}

/** The diff the reviewer would see for a case, made by the runtime's own git. */
export function diffFor(c: ReviewCase): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-review-"));
  const write = (files: Record<string, string>) => {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), content);
    }
  };
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  write(c.before);
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=shoji", "-c", "user.email=shoji@example.com", "commit", "-q", "-m", "start");
  write(c.after);
  const diff = diffOf(root);
  fs.rmSync(root, { recursive: true, force: true });
  return diff;
}

/** Asks the seat to review every case `trials` times, within the meter's cap. */
export async function reviewCheck(meter: Meter, seat: Seat, trials: number, cases = CASES): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const c of cases) {
    const content = reviewPrompt(c.task, diffFor(c), [{ command: "pnpm test", ok: true, output: "" }]);
    for (let i = 0; i < trials; i++) {
      const review = textOf(
        await meter.send("review", "review", {
          model: seat.model,
          effort: seat.effort,
          system: prompts.REVIEW,
          messages: [{ role: "user", content }],
          maxTokens: MAX_TOKENS,
        }),
      );
      const approved = approves(review);
      const named = !!c.bug && !approved && c.bug.named.test(review);
      verdicts.push({ case: c.name, planted: !!c.bug, approved, named, right: c.bug ? named : approved, review });
    }
  }
  return verdicts;
}

export function summary(verdicts: Verdict[]): string {
  const rows = [...new Set(verdicts.map((v) => v.case))].map((name) => {
    const runs = verdicts.filter((v) => v.case === name);
    const right = runs.filter((v) => v.right).length;
    const what = runs[0].planted ? "named the bug" : "approved";
    return `${right === runs.length ? "✓" : "✗"} ${name.padEnd(24)} ${what} ${right} of ${runs.length}`;
  });
  const bugs = verdicts.filter((v) => v.planted);
  const controls = verdicts.filter((v) => !v.planted);
  return [
    ...rows,
    "",
    `Planted bugs named: ${bugs.filter((v) => v.named).length} of ${bugs.length}`,
    `Correct changes approved: ${controls.filter((v) => v.approved).length} of ${controls.length}`,
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "claude-haiku-5-5" },
      effort: { type: "string", default: "low" },
      trials: { type: "string", default: "3" },
      cap: { type: "string", default: "0.10" },
      out: { type: "string" },
    },
  });
  const model = values.model as ModelId;
  if (!(model in MODELS)) throw new Error(`Unknown model ${model}.`);
  const apiKey = process.env.SHOJI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set SHOJI_API_KEY or ANTHROPIC_API_KEY.");
  const provider: ModelProvider = new AnthropicProvider(apiKey);
  const meter = new Meter(provider, () => {}, Number(values.cap));
  const seat = { model, effort: values.effort as Seat["effort"] };

  let verdicts: Verdict[] = [];
  try {
    verdicts = await reviewCheck(meter, seat, Number(values.trials));
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    console.log(error.message);
  }
  console.log(`${MODELS[model].label}, ${seat.effort} effort, $${meter.spent.toFixed(4)}\n`);
  console.log(summary(verdicts));
  if (values.out) {
    const record = { date: new Date().toISOString(), seat, spent: meter.spent, verdicts };
    fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
  }
}

if (import.meta.main) await main();
