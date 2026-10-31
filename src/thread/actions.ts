import type { LedgerThread } from "../bridge";
import { SEPARATOR, type MenuEntry } from "../shell/Menu";

/** What can be done to a thread from its row, its title or a right-click. */
export interface ThreadActions {
  rename: (thread: LedgerThread) => void;
  pin: (thread: LedgerThread, pinned: boolean) => void;
  archive: (thread: LedgerThread, archived: boolean) => void;
  discard: (thread: LedgerThread) => void;
  reveal: (thread: LedgerThread) => void;
  copyBranch: (thread: LedgerThread) => void;
}

/** Whether a thread's uncommitted work lives in its own copy, which Shoji can throw away with its branch. */
export const canDiscard = (t: LedgerThread) => !t.committed && !t.discardedAt && !!t.workdir;

/** The same list of actions wherever a thread's menu opens. A running thread can only be renamed, pinned or
 *  looked at. */
export function threadMenu(t: LedgerThread, actions: ThreadActions, running: boolean): MenuEntry[] {
  const busy = running ? { disabled: true } : {};
  return [
    { label: "Rename", hint: "F2", run: () => actions.rename(t) },
    ...(t.discardedAt ? [] : [{ label: t.pinned ? "Unpin" : "Pin", run: () => actions.pin(t, !t.pinned) }]),
    t.archivedAt
      ? { label: "Bring back", run: () => actions.archive(t, false) }
      : { label: "Archive", run: () => actions.archive(t, true), ...busy },
    ...(canDiscard(t)
      ? [
          {
            label: "Discard work",
            run: () => actions.discard(t),
            confirm: { ask: `Delete ${t.branch} and this thread's copy of the project? Its changes are lost.`, yes: "Discard" },
            ...busy,
          },
        ]
      : []),
    SEPARATOR,
    { label: "Open folder", run: () => actions.reveal(t) },
    ...(t.branch && !t.discardedAt ? [{ label: "Copy branch name", run: () => actions.copyBranch(t) }] : []),
  ];
}
