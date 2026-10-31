import { useEffect, useRef } from "react";
import { isDue, lastDue, type Schedule } from "./schedule";

/** How often Shoji looks for a task that's come due, and how long it waits after opening, so the stack and the
 *  key have loaded first. */
const EVERY_MS = 30_000;
const FIRST_MS = 5_000;

/**
 * Starts each scheduled task when it comes due, while Shoji is open, and once on opening for a time it missed.
 * `start` starts one and returns null, or says why it couldn't, which the schedule keeps to show.
 */
export function useSchedules(
  schedules: Schedule[],
  save: (schedules: Schedule[]) => void,
  start: (schedule: Schedule) => string | null,
) {
  const latest = useRef({ schedules, save, start });
  latest.current = { schedules, save, start };

  useEffect(() => {
    const look = () => {
      const { schedules, save, start } = latest.current;
      const now = new Date();
      if (!schedules.some((s) => isDue(s, now))) return;
      // Each is marked as it starts, so the next look leaves it until it next comes due.
      save(
        schedules.map((s) => {
          if (!isDue(s, now)) return s;
          const skipped = start(s);
          const { skipped: _, ...rest } = s;
          return { ...rest, last: lastDue(s, now)!.getTime(), ...(skipped && { skipped }) };
        }),
      );
    };
    let timer = setTimeout(function tick() {
      look();
      timer = setTimeout(tick, EVERY_MS);
    }, FIRST_MS);
    return () => clearTimeout(timer);
  }, []);
}
