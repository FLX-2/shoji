import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import type { Comparison } from "./compare";

/** The review's look score a change must reach. Under it, the review's visual notes go back to Build. */
export const LOOK_BAR = 8;

/** The widths Review sees: the narrowest and the widest, which between them show most of what breaks. */
const REVIEW_WIDTHS = [360, 1280];

/**
 * The pages before and after the change, as images with a line naming each, for Review to judge the look.
 * Empty when there is no pair to compare.
 */
export function lookBlocks(comparison: Comparison): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const page of comparison.pages) {
    for (const shot of page.shots) {
      if (!REVIEW_WIDTHS.includes(shot.width) || !shot.after) continue;
      for (const side of ["before", "after"] as const) {
        const file = shot[side];
        if (!file) continue;
        let data: string;
        try {
          data = fs.readFileSync(file).toString("base64");
        } catch {
          continue;
        }
        blocks.push({ type: "text", text: `${page.path} at ${shot.width}px, ${side} the change:` });
        blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data } });
      }
    }
  }
  return blocks.some((b) => b.type === "image") ? blocks : [];
}

/** The score on the review's LOOK: line, such as "LOOK: 7/10", when it gave one. */
export function lookScore(review: string): number | undefined {
  const found = review.match(/^\s*LOOK:\s*(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*10\b/im);
  if (!found) return undefined;
  const score = Number(found[1]);
  return score >= 0 && score <= 10 ? score : undefined;
}

/**
 * A review that approves a change but scores its look under the bar asks for fixes after all, so the person,
 * the fix round and Receipts all read the same verdict.
 */
export function holdToLook(review: string): string {
  const score = lookScore(review);
  if (score === undefined || score >= LOOK_BAR || !/^\s*VERDICT:\s*APPROVE/i.test(review)) return review;
  return review.replace(/^\s*VERDICT:\s*APPROVE\w*/i, "VERDICT: FIX");
}
