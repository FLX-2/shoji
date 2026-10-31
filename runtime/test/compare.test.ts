// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Browser, findBrowser } from "../src/browser";
import { compareBeforeAndAfter } from "../src/compare";
import { NO_PREVIEW, type Preview, previewFor } from "../src/preview";
import { tempRepo } from "./helpers";

// The browser Playwright keeps in some containers, when no Chrome is installed.
const BUNDLED = "/opt/pw-browsers/chromium";
const browser = process.env.SHOJI_BROWSER || (fs.existsSync(BUNDLED) ? BUNDLED : findBrowser());

/** A dev server that needs the project's .env, and serves page.html as it is on disk at each request. */
const SERVER = `
const fs = require("fs");
if (!fs.existsSync(".env")) { console.error("no .env"); process.exit(1); }
require("http").createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", "text/html");
  res.end(fs.readFileSync("page.html"));
}).listen(process.env.PORT, () => console.log("  Local:   http://localhost:" + process.env.PORT + "/"));
`;

const page = (colour: string) => `<title>Pricing</title><body style="margin:0;background:${colour}"></body>`;
/** A PNG's width, from its header. */
const widthOf = (file: string) => fs.readFileSync(file).readUInt32BE(16);
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

describe.skipIf(!browser)("comparing a thread's pages before and after", () => {
  it("shoots each page Build looked at, at every width, as it was at the start and as the work has it", async () => {
    const project = tempRepo({ "server.js": SERVER, "page.html": page("#ffffff"), ".gitignore": ".env\n" });
    fs.writeFileSync(path.join(project, ".env"), "PLAN=team\n");
    // The thread works in a linked worktree, as Shoji's threads do, with the project's .env copied in.
    const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shoji-wt-")), "work");
    expect(git(project, "worktree", "add", "-q", "-b", "shoji/annual", work).status).toBe(0);
    fs.copyFileSync(path.join(project, ".env"), path.join(work, ".env"));
    fs.writeFileSync(path.join(work, "page.html"), page("#000000"));

    const launch = () => Browser.launch(browser!);
    const after = previewFor(work, "node server.js", launch);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-shots-"));
    try {
      await after.look("/pricing", "1280");
      await after.look("/pricing", "360");
      const compared = await compareBeforeAndAfter({ root: work, devCommand: "node server.js", after, launch, dir });

      expect(compared.problem).toBeUndefined();
      expect(compared.pages.map((p) => p.path)).toEqual(["/pricing"]);
      const shots = compared.pages[0].shots;
      expect(shots.map((s) => s.width)).toEqual([360, 768, 1280]);
      for (const shot of shots) {
        expect(widthOf(shot.before!)).toBe(shot.width);
        expect(widthOf(shot.after!)).toBe(shot.width);
        expect(fs.readFileSync(shot.before!).equals(fs.readFileSync(shot.after!))).toBe(false);
      }
      // The work is as it was, and the scratch copy is gone.
      expect(fs.readFileSync(path.join(work, "page.html"), "utf8")).toBe(page("#000000"));
      expect(git(work, "status", "--porcelain").stdout.trim()).toBe("M page.html");
    } finally {
      await after.close();
    }
  }, 90_000);
});

describe("a comparison that can't show one side", () => {
  it("keeps the side it could show and says why the other is missing", async () => {
    const work = tempRepo({ "page.html": page("#ffffff") });
    const after: Preview = {
      ...NO_PREVIEW,
      looked: () => ["/", "/a", "/b", "/c"],
      shoot: async () => ({ png: "iVBORw0KGgo=", title: "", problems: [] }),
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-shots-"));
    const compared = await compareBeforeAndAfter({
      root: work,
      devCommand: `node -e "process.exit(3)"`,
      after,
      launch: async () => {
        throw new Error("no browser");
      },
      dir,
    });
    // The last three pages looked at.
    expect(compared.pages.map((p) => p.path)).toEqual(["/a", "/b", "/c"]);
    expect(compared.pages.every((p) => p.shots.every((s) => s.after && !s.before))).toBe(true);
    expect(compared.problem).toMatch(/^Couldn't show the pages as they were before: .*exit code 3/);
    expect(fs.readdirSync(dir)).toHaveLength(9);
  });

  it("does nothing when Build looked at no page", async () => {
    const dir = path.join(os.tmpdir(), `shoji-unused-${Date.now()}`);
    const compared = await compareBeforeAndAfter({
      root: ".",
      devCommand: "x",
      after: NO_PREVIEW,
      launch: async () => {
        throw new Error();
      },
      dir,
    });
    expect(compared).toEqual({ pages: [] });
    expect(fs.existsSync(dir)).toBe(false);
  });
});
