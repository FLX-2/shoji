import readline from "node:readline";
import { steerIn } from "./steer";

/**
 * The lines the app writes to a run's input: answers about commands, fresh sign-in tokens the run asked for, and
 * what the person writes to the run while it works. Each goes to whoever waits for its kind; one nobody waits for
 * yet is kept for the next to ask. Steers are only ever taken, never waited for.
 */
export class Inbox {
  private waiting = { answer: [] as ((line: string | null) => void)[], token: [] as ((line: string | null) => void)[] };
  private kept = { answer: [] as string[], token: [] as string[] };
  private steers: string[] = [];
  private closed = false;

  constructor(input: NodeJS.ReadableStream) {
    const lines = readline.createInterface({ input, terminal: false });
    lines.on("line", (line) => {
      const steer = steerIn(line);
      if (steer !== null) return void this.steers.push(steer);
      const kind = Inbox.kindOf(line);
      const next = this.waiting[kind].shift();
      if (next) next(line);
      else this.kept[kind].push(line);
    });
    lines.on("close", () => {
      this.closed = true;
      for (const kind of ["answer", "token"] as const) for (const next of this.waiting[kind].splice(0)) next(null);
    });
  }

  /** A line carrying a token is the app's reply to a token request; anything else answers a command. */
  static kindOf(line: string): "answer" | "token" {
    try {
      const value = JSON.parse(line) as { token?: unknown; signedOut?: unknown };
      return value && (typeof value.token === "string" || value.signedOut === true) ? "token" : "answer";
    } catch {
      return "answer";
    }
  }

  /** What the person wrote to the run since the last take, oldest first. */
  takeSteers(): string[] {
    return this.steers.splice(0);
  }

  /** The next line of a kind, or null once the input has closed. */
  next(kind: "answer" | "token"): Promise<string | null> {
    const kept = this.kept[kind].shift();
    if (kept !== undefined) return Promise.resolve(kept);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiting[kind].push(resolve));
  }
}

let shared: Inbox | undefined;

/** The run's one reader of its input. */
export const inbox = () => (shared ??= new Inbox(process.stdin));
