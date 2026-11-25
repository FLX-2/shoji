/** A note the person left on one line of a plan that waits for them. */
export interface PlanNote {
  /** The line's own words. */
  quote: string;
  text: string;
}

/** The notes, then what the person said with them, as one message for the planner. */
export function withNotes(notes: PlanNote[], said = ""): string {
  const listed = notes.map((n) => `- On “${n.quote}”: ${n.text}`).join("\n");
  return [
    notes.length ? `Notes on lines of the plan:\n${listed}` : "",
    said.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}
