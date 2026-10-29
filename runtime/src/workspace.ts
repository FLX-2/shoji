import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".turbo"]);
const MAX_FILE_BYTES = 1_000_000;

export class OutsideWorkspace extends Error {}

/** The project folder a thread works in. Every path a model gives is checked against it. */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = fs.realpathSync(root);
  }

  /** Resolves a model-supplied path, refusing anything outside the project or in a skipped folder. */
  resolve(relative: string): string {
    const full = path.resolve(this.root, relative || ".");
    this.assertInside(full);
    // Follow symlinks for the deepest part of the path that exists.
    let existing = full;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    this.assertInside(fs.realpathSync(existing));
    return full;
  }

  relative(full: string): string {
    return path.relative(this.root, full).split(path.sep).join("/");
  }

  read(relative: string): string {
    const full = this.resolve(relative);
    if (fs.statSync(full).size > MAX_FILE_BYTES) throw new Error(`${relative} is too large to read`);
    return fs.readFileSync(full, "utf8");
  }

  write(relative: string, content: string) {
    const full = this.resolve(relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  /** Every file under a folder, as project-relative paths, skipping build output and dependencies. */
  files(relative = "."): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(this.relative(full));
      }
    };
    walk(this.resolve(relative));
    return out.sort();
  }

  private assertInside(full: string) {
    const rel = path.relative(this.root, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new OutsideWorkspace("That path is outside the project.");
    }
    if (rel.split(path.sep).some((part) => SKIP.has(part))) {
      throw new OutsideWorkspace(`That path is inside a folder Shoji doesn't touch.`);
    }
  }
}
