import { describe, expect, it } from "vitest";
import { describeRepeat, describeWhen, isDue, lastDue, nextDue, type Schedule } from "./schedule";

// Wednesday 5 November 2025, 10:30 local time.
const NOW = new Date(2025, 10, 5, 10, 30);
const made = new Date(2025, 10, 1, 8, 0).getTime();
const schedule = (over: Partial<Schedule>): Schedule => ({
  id: "s",
  task: "Update the dependencies",
  repo: "/work/app",
  repeat: "day",
  time: "09:00",
  day: 1,
  tier: "balanced",
  created: made,
  ...over,
});

describe("when a scheduled task comes due", () => {
  it("finds the latest time it came due and the next", () => {
    expect(lastDue(schedule({}), NOW)).toEqual(new Date(2025, 10, 5, 9, 0));
    expect(nextDue(schedule({}), NOW)).toEqual(new Date(2025, 10, 6, 9, 0));
    expect(lastDue(schedule({ time: "11:00" }), NOW)).toEqual(new Date(2025, 10, 4, 11, 0));
    // Weekdays skip the weekend; Monday's came due two days ago.
    expect(lastDue(schedule({ repeat: "week", day: 1 }), NOW)).toEqual(new Date(2025, 10, 3, 9, 0));
    expect(nextDue(schedule({ repeat: "weekdays" }), new Date(2025, 10, 7, 10, 0))).toEqual(
      new Date(2025, 10, 10, 9, 0),
    );
    // Saturday's came due after it was made that morning; nothing before it was made counts.
    expect(lastDue(schedule({ repeat: "week", day: 6 }), NOW)).toEqual(new Date(2025, 10, 1, 9, 0));
    expect(lastDue(schedule({ repeat: "week", day: 6, created: made + 3_600_000 * 2 }), NOW)).toBeNull();
  });

  it("is due once for each time, including one missed while Shoji was closed", () => {
    expect(isDue(schedule({}), NOW)).toBe(true);
    expect(isDue(schedule({ last: new Date(2025, 10, 5, 9, 0).getTime() }), NOW)).toBe(false);
    // Closed since Monday: it runs once now, not once for each missed day.
    expect(isDue(schedule({ last: new Date(2025, 10, 3, 9, 0).getTime() }), NOW)).toBe(true);
    expect(isDue(schedule({ paused: true }), NOW)).toBe(false);
    expect(isDue(schedule({ created: NOW.getTime() }), NOW)).toBe(false);
  });

  it("says how often and when next in words", () => {
    expect(describeRepeat(schedule({ repeat: "weekdays" }))).toBe("Weekdays at 09:00");
    expect(describeRepeat(schedule({ repeat: "week", day: 5 }))).toBe("Every Friday at 09:00");
    expect(describeWhen(new Date(2025, 10, 5, 17, 0), NOW)).toBe("today 17:00");
    expect(describeWhen(new Date(2025, 10, 6, 9, 0), NOW)).toBe("tomorrow 09:00");
    expect(describeWhen(new Date(2025, 10, 10, 9, 0), NOW)).toBe("Mon 09:00");
  });
});
