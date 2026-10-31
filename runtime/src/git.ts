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

/** Everything the thread changed, new files included, using the person's own git. Files for
 *  which `hidden` holds are left out, so a private file never reaches a model through a diff. */
export function diffOf(root: string, hidden: (file: string) => boolean = () => false): string {
  // Mark new files as intended, so they show in the diff without being staged.
  git(root, ["add", "--all", "--intent-to-add", "."]);
  const left = git(root, ["diff", "--name-only", "-z", ...NOT_LOCKFILES])
    .stdout.split("\0")
    .filter((file) => file && hidden(file))
    .map((file) => `:(exclude,literal)${file}`);
  return git(root, ["diff", "--no-color", ...NOT_LOCKFILES, ...left]).stdout;
}

/** What one commit changed, against its parent, in the same form as diffOf. */
export function commitDiff(root: string, commit: string): string {
  return git(root, ["diff", "--no-color", "--no-renames", `${commit}^`, commit, ...NOT_LOCKFILES]).stdout;
}

/** Throws away everything the thread changed since its last commit, new files too. Ignored files stay. */
export function discardWork(root: string): void {
  git(root, ["reset", "--hard", "--quiet", "HEAD"]);
  git(root, ["clean", "-fd", "--quiet"]);
}
