/**
 * What the person writes to a run while it works. A step that works in turns takes what's waiting at its next turn,
 * so the words reach the work within seconds; a step that is one answer, as Plan and Review are, takes it before
 * it starts. Whatever no step took by the end is handed back with the result, for the app to send next.
 */
export interface Steering {
  /** What the person wrote since the last take, oldest first. Taking empties it. */
  take(): string[];
}

/** A run nobody can write to. */
export const NO_STEERING: Steering = { take: () => [] };

/** Holds what it's given until a step takes it. */
export class SteerBox implements Steering {
  private held: string[] = [];

  add(said: string): void {
    const text = said.trim();
    if (text) this.held.push(text);
  }

  take(): string[] {
    return this.held.splice(0);
  }
}

/** What a step is told when the person wrote to it while it worked. */
export function steerNote(said: string[]): string {
  const lines = said.length === 1 ? said[0] : said.map((s) => `- ${s}`).join("\n");
  return `While you worked, the person added:\n${lines}\n\nTake this into account from here on. Keep the work that's already right.`;
}

/** A steer as the app writes it on the run's input: {"steer":"…"}. Null for any other line. */
export function steerIn(line: string): string | null {
  try {
    const value = JSON.parse(line) as { steer?: unknown };
    return value && typeof value.steer === "string" ? value.steer : null;
  } catch {
    return null;
  }
}
