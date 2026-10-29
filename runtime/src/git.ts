import { spawnSync } from "node:child_process";

function git(root: string, args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 50_000_000, windowsHide: true });
}

export function isGitRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

export function hasChanges(root: string): boolean {
  return git(root, ["status", "--porcelain"]).stdout.trim() !== "";
}

/** Everything the thread changed, new files included, using the person's own git. */
export function diffOf(root: string): string {
  // Mark new files as intended, so they show in the diff without being staged.
  git(root, ["add", "--all", "--intent-to-add", "."]);
  return git(root, ["diff", "--no-color", "--", ".", ":(exclude)*.lock", ":(exclude)*-lock.json", ":(exclude)*-lock.yaml"])
    .stdout;
}
