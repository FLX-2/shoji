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

/** Lockfiles change in bulk and say little, so diffs leave them out. */
const NOT_LOCKFILES = ["--", ".", ":(exclude)*.lock", ":(exclude)*-lock.json", ":(exclude)*-lock.yaml"];

/** Everything the thread changed, new files included, using the person's own git. */
export function diffOf(root: string): string {
  // Mark new files as intended, so they show in the diff without being staged.
  git(root, ["add", "--all", "--intent-to-add", "."]);
  return git(root, ["diff", "--no-color", ...NOT_LOCKFILES]).stdout;
}

/** What one commit changed, against its parent, in the same form as diffOf. */
export function commitDiff(root: string, commit: string): string {
  return git(root, ["diff", "--no-color", "--no-renames", `${commit}^`, commit, ...NOT_LOCKFILES]).stdout;
}
