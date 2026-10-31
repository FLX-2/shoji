import type { LedgerThread } from "../bridge";
import { threadState } from "../thread/ThreadList";

export interface Project {
  repo: string;
  /** Threads with a run going now. */
  running: number;
  /** Threads waiting for the person: ready to accept, a plan to check, or work the review sent back. */
  waiting: number;
  /** When the latest thread in it started, or 0 for a project with none yet. */
  last: number;
}

/** Every project the person has worked in, the open one included, latest first. */
export function projectsFrom(threads: LedgerThread[], running: Set<number>, open: string | null): Project[] {
  const projects = new Map<string, Project>();
  const of = (repo: string) => {
    if (!projects.has(repo)) projects.set(repo, { repo, running: 0, waiting: 0, last: 0 });
    return projects.get(repo)!;
  };
  if (open) of(open);
  for (const thread of threads) {
    const project = of(thread.repo);
    const { group } = threadState(thread, running);
    if (group === "Running") project.running++;
    if (group === "Needs you") project.waiting++;
    project.last = Math.max(project.last, thread.startedAt);
  }
  return [...projects.values()].sort((a, b) => b.last - a.last);
}
