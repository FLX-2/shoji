import { useCallback, useEffect, useState } from "react";
import type { AvailableUpdate, Bridge } from "../bridge";
import type { Note } from "./Toast";

/** How long after opening Shoji asks GitHub, so the check never competes with the first screen. */
export const CHECK_AFTER = 5000;

type Stage = { at: "none" } | { at: "ready"; update: AvailableUpdate } | { at: "installing"; update: AvailableUpdate };

/**
 * Looks once, a little after Shoji opens, for a newer release, and offers it as a note that waits at the foot
 * of the window. The note holds back while anything runs, since installing closes Shoji and would end the run.
 * Closing the note sets the update aside until Shoji next opens.
 */
export function useUpdate(bridge: Bridge, on: boolean, running: boolean, failed: (error: unknown) => void) {
  const [stage, setStage] = useState<Stage>({ at: "none" });
  const [setAside, setSetAside] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    const timer = setTimeout(() => {
      bridge
        .checkUpdate()
        .then((update) => {
          if (live && update) setStage({ at: "ready", update });
        })
        // A check that can't reach GitHub just finds nothing; the next opening tries again.
        .catch(() => {});
    }, CHECK_AFTER);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, on]);

  const install = useCallback(
    (update: AvailableUpdate) => {
      setStage({ at: "installing", update });
      bridge.installUpdate().catch((error) => {
        setStage({ at: "ready", update });
        setSetAside(true);
        failed(error);
      });
    },
    [bridge, failed],
  );

  let note: Note | null = null;
  if (on && !setAside && stage.at === "installing") {
    note = { text: `Installing Shoji ${stage.update.version}. Shoji opens again when it's done.`, stays: true };
  } else if (on && !setAside && stage.at === "ready" && !running) {
    const update = stage.update;
    note = {
      text: `Shoji ${update.version} is ready.`,
      stays: true,
      action: { label: "Restart to update", run: () => install(update) },
    };
  }
  const close = useCallback(() => setSetAside(true), []);
  return { note, close };
}
