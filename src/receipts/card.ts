import type { LedgerThread } from "../bridge";
import { folderName } from "../home/HomeView";
import { threadTitle } from "../thread/title";
import { modelLabel, outcome, receipt } from "./receipts";

/** What a shared receipt says: the task, where it ran, each step's model and cost, the total, and what it's
 *  compared with. No code, no paths beyond the project's folder name, and no account. */
export interface Card {
  title: string;
  meta: string;
  lines: [string, string][];
  /** Steps past the ones that fit, said as one line. */
  more: number;
  total: string;
  compared: [string, string] | null;
}

const STEP_NAMES: Record<string, string> = {
  scout: "Scout",
  plan: "Plan",
  build: "Build",
  changes: "Changes",
  "fix-1": "Fix",
  "fix-2": "Second fix",
  review: "Review",
  notes: "Project notes",
};

/** The most step lines a card holds before the rest are counted. */
const MOST_LINES = 6;

const dollars = (amount: number) =>
  amount > 0 && amount < 0.0005 ? "<$0.001" : `$${amount.toFixed(3)}`;

/** A step's cost on the card, or where it ran when that charged nothing. */
export function costWords(model: string, cost: number): string {
  if (model.startsWith("chatgpt/")) return "On your ChatGPT plan";
  if (model.startsWith("ollama/")) return "On this computer";
  if (cost === 0 && model.startsWith("gemini/")) return "On Gemini's free tier";
  if (cost === 0 && model.startsWith("openrouter/")) return "Free on OpenRouter";
  return dollars(cost);
}

export function cardOf(thread: LedgerThread): Card {
  const r = receipt(thread);
  const lines = r.lines.map(
    (line): [string, string] => [`${STEP_NAMES[line.step] ?? line.step} · ${modelLabel(line.model)}`, costWords(line.model, line.cost)],
  );
  return {
    title: threadTitle(thread),
    meta: `${folderName(thread.repo)} · ${thread.committed ? "Accepted" : outcome(thread)}`,
    lines: lines.slice(0, MOST_LINES),
    more: Math.max(0, lines.length - MOST_LINES),
    total: dollars(r.total),
    compared:
      r.lines.length && r.oneModel - r.total >= 0.0005
        ? [r.baselineName === "Claude" ? "On Claude, estimated" : `On ${r.baselineName} alone, estimated`, dollars(r.oneModel)]
        : null,
  };
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The card's colours and type, read from the theme so a shared receipt looks like the app it came from. */
function look() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ground: token("--z1", "#0e0d0c"),
    panel: token("--z5", "#4d4b48"),
    fold: token("--z4", "#33312f"),
    hair: token("--z4", "#33312f"),
    text: token("--z10", "#f8f6f2"),
    body: token("--z8", "#bebab4"),
    quiet: token("--z6", "#84817c"),
    sans: token("--sans", "system-ui, sans-serif"),
  };
}

/** Text cut to fit a width, with an ellipsis where it was cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Draws the card at twice its size, for sharp text on any screen it's shared to. */
export function drawCard(canvas: HTMLCanvasElement, card: Card): boolean {
  const scale = 2;
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.scale(scale, scale);
  const c = look();
  const pad = 72;
  const right = CARD_WIDTH - pad;

  ctx.fillStyle = c.ground;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // The mark, as the app draws it inside: two panels, with no seal.
  ctx.fillStyle = c.panel;
  ctx.fillRect(pad, pad, 15, 21);
  ctx.fillRect(pad + 9, pad, 15, 21);
  ctx.fillStyle = c.fold;
  ctx.fillRect(pad + 9, pad, 6, 21);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = c.body;
  ctx.font = `500 22px ${c.sans}`;
  ctx.fillText("shoji", pad + 36, pad + 18);

  ctx.fillStyle = c.text;
  ctx.font = `500 40px ${c.sans}`;
  ctx.fillText(fit(ctx, card.title, right - pad), pad, pad + 96);
  ctx.fillStyle = c.quiet;
  ctx.font = `400 22px ${c.sans}`;
  ctx.fillText(fit(ctx, card.meta, right - pad), pad, pad + 134);

  let y = pad + 196;
  const row = (label: string, value: string, color: string, size: number) => {
    ctx.font = `400 ${size}px ${c.sans}`;
    ctx.fillStyle = color;
    const width = ctx.measureText(value).width;
    ctx.fillText(fit(ctx, label, right - pad - width - 32), pad, y);
    ctx.fillText(value, right - width, y);
    y += size + 16;
  };
  for (const [label, value] of card.lines) row(label, value, c.body, 22);
  if (card.more) row(`${card.more} more ${card.more === 1 ? "step" : "steps"}`, "", c.quiet, 22);

  y = Math.max(y, CARD_HEIGHT - pad - 92);
  ctx.fillStyle = c.hair;
  ctx.fillRect(pad, y - 28, right - pad, 1);
  y += 10;
  ctx.font = `500 30px ${c.sans}`;
  ctx.fillStyle = c.text;
  ctx.fillText("Total", pad, y);
  const total = ctx.measureText(card.total).width;
  ctx.fillText(card.total, right - total, y);
  if (card.compared) {
    y += 42;
    row(card.compared[0], card.compared[1], c.quiet, 22);
  }
  return true;
}

/** Puts the card on the clipboard as a picture. Drawn here, never uploaded. */
export async function copyCard(thread: LedgerThread): Promise<void> {
  const canvas = document.createElement("canvas");
  if (!drawCard(canvas, cardOf(thread))) throw new Error("Shoji couldn't draw the receipt here.");
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    throw new Error("This system's clipboard doesn't take pictures from Shoji.");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
