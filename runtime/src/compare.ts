import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "./browser";
import { type Preview, previewFor, WIDTHS } from "./preview";
import { removeCopy, scratchCopy } from "./trial";

/** Most pages compared after a run: the last ones Build looked at. */
const MOST_PAGES = 3;

/** One width of a page: its screenshot before the thread's work and after it, as PNG files. */
export interface ComparedShot {
  width: number;
  before?: string;
  after?: string;
}

export interface ComparedPage {
  /** The page's path on the dev server, such as /pricing. */
  path: string;
  shots: ComparedShot[];
}

export interface Comparison {
  pages: ComparedPage[];
  /** Why a side is missing, in plain words, when one is. */
  problem?: string;
}

interface CompareOptions {
  /** The thread's copy of the project, with the work in it uncommitted. */
  root: string;
  devCommand: string;
  /** The preview Build used, still serving the work. */
  after: Preview;
  launch: () => Promise<Browser>;
  /** Where the screenshots go. */
  dir: string;
  /** The commit the thread started from. */
  base?: string;
}

/** Compares the pages Build looked at, again and again as the work changes. */
export interface Comparer {
  /** The pages as they are now, beside how they were. Each page's before is shot once and kept, since the start
   *  doesn't change; the after is shot fresh each time. */
  take(): Promise<Comparison>;
}

/**
 * Screenshots of the pages Build looked at, at each width, as they were at the thread's starting commit and as
 * they are now. The work's own dev server shows the after; the before comes from a scratch copy at `base`, with
 * a dev server of its own, so the project and the work are never touched. Calls no model.
 */
export function comparer({ root, devCommand, after, launch, dir, base = "HEAD" }: CompareOptions): Comparer {
  /** Before shots already taken, by page and width. */
  const befores = new Map<string, string>();
  /** Why the before couldn't be shown, once it couldn't: the start doesn't change, so it isn't tried again. */
  let beforeProblem: string | undefined;
  let round = 0;
  return {
    async take() {
      const paths = after.looked().slice(-MOST_PAGES);
      const pages: ComparedPage[] = paths.map((p) => ({ path: p, shots: WIDTHS.map((width) => ({ width })) }));
      if (!pages.length) return { pages };
      fs.mkdirSync(dir, { recursive: true });
      round++;
      const problems: string[] = [];

      // Each round's after has a file of its own, so a figure already shown keeps showing what it showed.
      const prefix = round === 1 ? "after" : `after${round}`;
      try {
        for (const [i, page] of pages.entries()) {
          for (const shot of page.shots) {
            const look = await after.shoot(page.path, shot.width);
            const file = path.join(dir, `${prefix}-${i + 1}-${shot.width}.png`);
            fs.writeFileSync(file, Buffer.from(look.png, "base64"));
            shot.after = file;
          }
        }
      } catch (error) {
        problems.push(`Couldn't show the pages as they are now: ${message(error)}`);
      }

      const key = (page: string, width: number) => `${width} ${page}`;
      const missing = pages.flatMap((page) => page.shots.filter((s) => !befores.has(key(page.path, s.width))).map((s) => ({ page, s })));
      if (beforeProblem) problems.push(beforeProblem);
      else if (missing.length) {
        let copy: string | undefined;
        let before: Preview | undefined;
        try {
          const commit = spawnSync("git", ["rev-parse", "--verify", `${base}^{commit}`], {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
          });
          if (commit.status !== 0) throw new Error(`${base} isn't a commit in the project.`);
          copy = scratchCopy(root, commit.stdout.trim());
          bringEnvFiles(root, copy);
          before = previewFor(copy, devCommand, launch);
          for (const { page, s } of missing) {
            const look = await before.shoot(page.path, s.width);
            const file = path.join(dir, `before-${befores.size + 1}-${s.width}.png`);
            fs.writeFileSync(file, Buffer.from(look.png, "base64"));
            befores.set(key(page.path, s.width), file);
          }
        } catch (error) {
          beforeProblem = `Couldn't show the pages as they were before: ${message(error)}`;
          problems.push(beforeProblem);
        } finally {
          await before?.close().catch(() => {});
          if (copy) removeCopy(copy);
        }
      }
      for (const page of pages) {
        for (const shot of page.shots) {
          const file = befores.get(key(page.path, shot.width));
          if (file) shot.before = file;
        }
      }

      return { pages, ...(problems.length && { problem: problems.join(" ") }) };
    },
  };
}

/** One comparison of the pages Build looked at. */
export function compareBeforeAndAfter(options: CompareOptions): Promise<Comparison> {
  return comparer(options).take();
}

/** A project's .env files are kept out of git, so a copy made by git lacks them; its dev server may need them. */
function bringEnvFiles(root: string, copy: string) {
  for (const name of fs.readdirSync(root)) {
    if (!/^\.env/.test(name) || fs.existsSync(path.join(copy, name))) continue;
    if (fs.statSync(path.join(root, name)).isFile()) fs.copyFileSync(path.join(root, name), path.join(copy, name));
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
