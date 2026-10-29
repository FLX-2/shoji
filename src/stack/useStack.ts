import { useCallback, useEffect, useState } from "react";
import { STACKS, type Stack, type StackName } from "../../runtime/src/stack";
import type { Bridge } from "../bridge";
import { parseLock, serializeLock, type StackLock } from "./lock";

/** The stack in use, read from stack.lock. Before anything is saved it's `fallback`, the preset
 *  chosen in Settings before stack.lock existed. */
export function useStack(bridge: Bridge, fallback: StackName) {
  const [lock, setLock] = useState<StackLock>({ versions: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge
      .readStackLock()
      .then((text) => text && setLock(parseLock(text)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bridge]);

  const save = useCallback(
    async (stack: Stack) => {
      const next = { versions: [...lock.versions, { at: Date.now(), stack }] };
      await bridge.writeStackLock(serializeLock(next));
      setLock(next);
      setError(null);
    },
    [bridge, lock],
  );

  const stack = lock.versions[lock.versions.length - 1]?.stack ?? STACKS[fallback] ?? STACKS.balanced;
  return { stack, lock, error, save };
}
