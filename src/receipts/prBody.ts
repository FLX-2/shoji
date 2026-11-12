import type { LedgerThread } from "../bridge";
import { cardOf, costWords, dollars, STEP_NAMES } from "./card";
import { modelLabel, receipt } from "./receipts";

const SITE = "https://shoji-app.vercel.app/";

/** A cell's text, with the characters that would break a Markdown table taken care of. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** What the last review said of the work that was accepted, or nothing when it didn't get one. */
function verdict(thread: LedgerThread): string | null {
  const last = thread.runs.filter((run) => run.kind !== "trial" && run.kind !== "notes").at(-1);
  if (last?.status === "ready") return "Review passed.";
  if (last?.status === "needs-work") return "Accepted with Review's notes still open.";
  return null;
}

/** The receipt as a pull request's description: each step's model and cost, the total, what it's compared
 *  with, and the review's verdict. Like the shared card, it holds no code, task, paths or account. */
export function prBody(thread: LedgerThread): string | null {
  const r = receipt(thread);
  if (!r.lines.length) return null;
  const card = cardOf(thread);
  const rows = r.lines.map(
    (line) =>
      `| ${cell(STEP_NAMES[line.step] ?? line.step)} | ${cell(modelLabel(line.model))} | ${cell(costWords(line.model, line.cost))} |`,
  );
  const after = [card.compared && `${card.compared[0]}: ${card.compared[1]}.`, verdict(thread)].filter(Boolean);
  return [
    "### Receipt",
    "",
    "| Step | Model | Cost |",
    "| :-- | :-- | --: |",
    ...rows,
    `| **Total** | | **${dollars(r.total)}** |`,
    ...(after.length ? ["", after.join(" ")] : []),
    "",
    `<sub>Made with [Shoji](${SITE}), which picks the model for each step.</sub>`,
  ].join("\n");
}
