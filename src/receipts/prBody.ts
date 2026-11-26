import type { LedgerThread } from "../bridge";
import { foldRun } from "../thread/fold";
import type { Thread } from "../thread/useThread";
import { cardOf, dollars } from "./card";
import { modelLabel, receipt } from "./receipts";

const SITE = "https://shoji-app.vercel.app/";

/** The most files the description names before it counts the rest. The whole description rides in the link
 *  that opens the pull request page, where every space and comma takes three characters, so it stays short. */
const MOST_FILES = 30;
/** The most of the builders' summaries the description keeps, all told. */
const MOST_SUMMARY = 1200;

/** What the last review said of the work that was accepted, or nothing when it didn't get one. */
function verdict(thread: LedgerThread): string | null {
  const last = thread.runs.filter((run) => run.kind !== "trial" && run.kind !== "notes").at(-1);
  if (last?.status === "ready") return "Review passed";
  if (last?.status === "needs-work") return "Accepted with Review's notes still open";
  return null;
}

/** What a step answers when it used every turn, as the runtime words it, which sums up nothing. */
const OUT_OF_TURNS = /^\(The step ran out of turns/;

/** What each run's builder said it changed, in order: the first build in a run, since a fix round after it
 *  sums up only the fix. */
function summaries(thread: Thread): string[] {
  return thread.turns.flatMap((turn) => {
    const said = foldRun(turn.events)
      .steps.find((s) => s.role === "build" && s.output?.trim() && !OUT_OF_TURNS.test(s.output.trim()))
      ?.output?.trim();
    return said ? [said] : [];
  });
}

/** Text cut to the most the description keeps, with an ellipsis where it was cut. */
const cut = (text: string) => (text.length > MOST_SUMMARY ? `${text.slice(0, MOST_SUMMARY).trimEnd()}…` : text);

/** The files the thread's work changed, from each run's diff, with whether the last one made or removed it. */
export function changedFiles(thread: Thread): { path: string; how?: "new" | "removed" }[] {
  const files = new Map<string, "new" | "removed" | undefined>();
  for (const turn of thread.turns) {
    const diff = foldRun(turn.events).result?.diff ?? "";
    for (const part of diff.split(/^(?=diff --git )/m)) {
      const head = part.match(/^diff --git a\/(.+?) b\/(.+)$/m);
      if (!head) continue;
      const path = head[2];
      files.delete(path);
      files.set(path, /^new file mode/m.test(part) ? "new" : /^deleted file mode/m.test(part) ? "removed" : undefined);
    }
  }
  return [...files].map(([path, how]) => (how ? { path, how } : { path }));
}

const MADE_WITH = `Made with [Shoji](${SITE})`;

/** The last line: Made with Shoji, and with the cost, what the thread spent on which models, what one model
 *  would have cost, and Review's verdict. */
function lastLine(record: LedgerThread | null, withCost: boolean): string {
  const r = withCost && record ? receipt(record) : null;
  if (!record || !r?.lines.length) return MADE_WITH;
  const models = [...new Set(r.lines.map((line) => modelLabel(line.model)))];
  const named = models.length > 1 ? `${models.slice(0, -1).join(", ")} and ${models.at(-1)}` : models[0];
  const compared = cardOf(record).compared;
  return [
    `${dollars(r.total)} on ${named}`,
    compared && `${compared[0]}: ${compared[1]}`,
    verdict(record),
    MADE_WITH,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A pull request's description: what changed, in the builder's words, then the files it changed, and one
 * short line at the end that says it was made with Shoji, and with `withCost`, what it cost. Null when
 * there's nothing to say, so the host fills it in from the commit.
 */
export function prBody(thread: Thread, record: LedgerThread | null, withCost: boolean): string | null {
  const said = summaries(thread);
  const files = changedFiles(thread);
  const last = lastLine(record, withCost);
  if (!said.length && !files.length) return last === MADE_WITH ? null : `<sub>${last}</sub>`;
  const listed = files
    .slice(0, MOST_FILES)
    .map((f) => `- \`${f.path}\`${f.how ? ` (${f.how})` : ""}`);
  if (files.length > MOST_FILES) listed.push(`- and ${files.length - MOST_FILES} more`);
  return [
    ...(said.length ? [cut(said.join("\n\n")), ""] : []),
    ...(files.length ? ["### Files changed", "", ...listed, ""] : []),
    "---",
    "",
    `<sub>${last}</sub>`,
  ]
    .join("\n")
    .trimEnd();
}
