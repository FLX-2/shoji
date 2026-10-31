import type { LedgerThread } from "../bridge";
import { foldRun } from "./fold";
import type { Thread } from "./useThread";

/** The task's first line, which names a thread until it has a title. */
export const firstLine = (task: string) => task.split("\n")[0];

/** What a thread is called: the person's name for it, Scout's title, or the first line of its task. */
export function threadTitle(thread: Pick<LedgerThread, "task"> & { title?: string | null }): string {
  return thread.title || firstLine(thread.task);
}

/** A live thread's name, which takes Scout's title as soon as its brief arrives. */
export function liveTitle(thread: Thread): string {
  if (thread.title) return thread.title;
  for (const turn of thread.turns) {
    const title = foldRun(turn.events).title;
    if (title) return title;
  }
  return firstLine(thread.task);
}
