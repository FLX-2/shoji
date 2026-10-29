import { useCallback, useEffect, useState } from "react";
import type { Bridge } from "../bridge";
import { parseDiff, type FileDiff } from "./diff";

export interface Changes {
  files: FileDiff[];
  accepted: Set<string>;
}

/** The project's changes since its last commit, read again whenever `version` moves. */
export function useChanges(bridge: Bridge, repo: string, version: unknown) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      bridge.changes(repo).then(
        (c) => {
          setChanges({ files: parseDiff(c.diff), accepted: new Set(c.accepted) });
          setError(null);
        },
        (e) => setError(String(e)),
      ),
    [bridge, repo],
  );

  useEffect(() => {
    reload();
  }, [reload, version]);

  /** Runs a git action on one file, then shows the project as it now stands. */
  const act = useCallback(
    (work: Promise<void>) =>
      work.then(
        () => reload(),
        (e) => setError(String(e)),
      ),
    [reload],
  );

  return { changes, error, reload, act };
}
