/** The starter tasks Scout's notes suggest, from their "First tasks" section: at most three, one per line. */
export function startersIn(notes: string): string[] {
  const lines = notes.split("\n");
  const at = lines.findIndex((line) => /^#{1,3}\s*first tasks\s*$/i.test(line.trim()));
  if (at < 0) return [];
  const tasks: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#/.test(line.trim())) break;
    const task = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();
    if (task) tasks.push(task);
  }
  return tasks.slice(0, 3);
}
