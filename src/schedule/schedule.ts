import type { Tier } from "../stack/tier";

/** How often a scheduled task runs. */
export type Repeat = "day" | "weekdays" | "week";

export const REPEATS: Record<Repeat, string> = {
  day: "Every day",
  weekdays: "Weekdays",
  week: "Every week",
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A task Shoji starts by itself at a set time, in a project, while it's open. */
export interface Schedule {
  id: string;
  task: string;
  repo: string;
  repeat: Repeat;
  /** The time of day, as "09:00". */
  time: string;
  /** For a weekly task, the day: 0 is Sunday. */
  day: number;
  tier: Tier;
  paused?: boolean;
  /** When it was made, in ms; times before it never count as missed. */
  created: number;
  /** The time it last came due, in ms, whether it ran or was skipped. */
  last?: number;
  /** Why it didn't run the last time it came due. */
  skipped?: string;
}

/** Whether a task with this repeat runs on a day of the week. */
function runsOn(schedule: Pick<Schedule, "repeat" | "day">, weekday: number): boolean {
  if (schedule.repeat === "weekdays") return weekday >= 1 && weekday <= 5;
  if (schedule.repeat === "week") return weekday === schedule.day;
  return true;
}

/** The task's time on the day `days` from `now`'s, in local time. */
function at(schedule: Pick<Schedule, "time">, now: Date, days: number): Date {
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes);
  return day;
}

/** The latest time the task came due, up to now, or null if it hasn't since it was made. */
export function lastDue(schedule: Schedule, now: Date): Date | null {
  for (let back = 0; back <= 7; back++) {
    const time = at(schedule, now, -back);
    if (time > now || !runsOn(schedule, time.getDay())) continue;
    return time.getTime() >= schedule.created ? time : null;
  }
  return null;
}

/** The next time the task comes due after now. */
export function nextDue(schedule: Schedule, now: Date): Date {
  for (let ahead = 0; ; ahead++) {
    const time = at(schedule, now, ahead);
    if (time > now && runsOn(schedule, time.getDay())) return time;
  }
}

/**
 * Whether the task should start now: it came due since it last did. A time missed while Shoji was closed counts,
 * so the task runs once when Shoji opens again.
 */
export function isDue(schedule: Schedule, now: Date): boolean {
  if (schedule.paused) return false;
  const due = lastDue(schedule, now);
  return !!due && due.getTime() > (schedule.last ?? schedule.created - 1);
}

/** How often and when, as "Weekdays at 09:00". */
export function describeRepeat(schedule: Pick<Schedule, "repeat" | "time" | "day">): string {
  if (schedule.repeat === "week") return `Every ${DAYS[schedule.day]} at ${schedule.time}`;
  return `${REPEATS[schedule.repeat]} at ${schedule.time}`;
}

/** A coming time, as "today 09:00", "tomorrow 09:00" or "Mon 09:00". */
export function describeWhen(time: Date, now: Date): string {
  const clock = time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round(
    (new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  return `${DAYS[time.getDay()].slice(0, 3)} ${clock}`;
}
