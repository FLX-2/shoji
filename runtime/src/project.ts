import fs from "node:fs";
import path from "node:path";

/** The project's own scripts, run with whichever package manager its lockfile names. */
export function defaultChecks(root: string): string[] {
  const pkgFile = path.join(root, "package.json");
  if (!fs.existsSync(pkgFile)) return [];
  const scripts: Record<string, string> = JSON.parse(fs.readFileSync(pkgFile, "utf8")).scripts ?? {};
  const pm = fs.existsSync(path.join(root, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(root, "yarn.lock"))
      ? "yarn"
      : fs.existsSync(path.join(root, "bun.lock"))
        ? "bun"
        : "npm";
  return ["typecheck", "lint", "test"].filter((s) => s in scripts).map((s) => `${pm} run ${s}`);
}
