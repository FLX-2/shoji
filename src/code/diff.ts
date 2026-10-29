export interface DiffLine {
  kind: "add" | "del" | "ctx";
  /** Line number before the change, for removed and unchanged lines. */
  old?: number;
  /** Line number after the change, for added and unchanged lines. */
  new?: number;
  text: string;
}

export interface Hunk {
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: "added" | "deleted" | "modified";
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

/** Splits a unified git diff into its files, hunks and numbered lines. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = { path: pathOf(line), status: "modified", binary: false, hunks: [], additions: 0, deletions: 0 };
      files.push(file);
      hunk = null;
    } else if (!file) {
      continue;
    } else if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("Binary files ")) file.binary = true;
      else if (line.startsWith("+++ b/")) file.path = line.slice(6);
      else if (line.startsWith("@@")) hunk = startHunk(file, line);
    } else if (line.startsWith("@@")) {
      hunk = startHunk(file, line);
    } else if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", new: newLine++, text: line.slice(1) });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", old: oldLine++, text: line.slice(1) });
      file.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "ctx", old: oldLine++, new: newLine++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and the trailing empty line carry nothing to show.
  }
  return files;

  function startHunk(file: FileDiff, header: string): Hunk {
    const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    oldLine = Number(match?.[1] ?? 0);
    newLine = Number(match?.[2] ?? 0);
    const next: Hunk = { lines: [] };
    file.hunks.push(next);
    return next;
  }
}

/** The path from a "diff --git a/x b/x" line. Both sides match, since renames are off. */
function pathOf(header: string): string {
  const rest = header.slice("diff --git a/".length);
  return rest.slice(0, (rest.length - 3) / 2);
}
