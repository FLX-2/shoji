import { useCallback, useEffect, useRef, useState } from "react";

/** How many more times a look the person asked for tries while nothing answers, and how long it waits between.
 *  Ollama and LM Studio take a few seconds to answer after they open, which is just when someone looks again. */
export const RETRIES = 4;
export const RETRY_MS = 2000;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Where a look ends: "off" when nothing answered, "ready" when something did with models Shoji can use. */
type Found = { status: string };

/**
 * Something on this computer that Shoji finds by asking it, such as Ollama or LM Studio's server. It asks once at
 * launch, again whenever Shoji's window comes back into focus, as after the person opens Ollama and switches back,
 * and on request. A look the person asks for keeps trying for a few seconds while nothing answers, and `missed`
 * says when it still found nothing, so the row can say it looked rather than seem to do nothing.
 */
export function useLooking<S extends Found>(
  ask: () => Promise<S>,
  first: () => S,
): S & { missed: boolean; look: () => void } {
  const [state, setState] = useState<S & { missed: boolean }>(() => ({ ...first(), missed: false }));
  const busy = useRef(false);
  const gone = useRef(false);

  const quietly = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    ask().then((found) => {
      busy.current = false;
      if (gone.current) return;
      setState((now) => {
        const { missed, ...was } = now;
        return JSON.stringify(was) === JSON.stringify(found) ? now : { ...found, missed: missed && found.status !== "ready" };
      });
    });
  }, [ask]);

  const look = useCallback(async () => {
    busy.current = true;
    setState((now) => ({ ...now, status: "looking", missed: false }));
    let found = await ask();
    for (let tries = 0; found.status === "off" && tries < RETRIES && !gone.current; tries++) {
      await wait(RETRY_MS);
      found = await ask();
    }
    busy.current = false;
    if (!gone.current) setState({ ...found, missed: found.status !== "ready" });
  }, [ask]);

  useEffect(() => {
    gone.current = false;
    busy.current = false;
    quietly();
    const visible = () => document.visibilityState === "visible" && quietly();
    window.addEventListener("focus", quietly);
    document.addEventListener("visibilitychange", visible);
    return () => {
      gone.current = true;
      window.removeEventListener("focus", quietly);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [quietly]);

  const lookAgain = useCallback(() => void look(), [look]);
  return { ...state, look: lookAgain };
}
