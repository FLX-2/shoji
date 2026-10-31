import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import type { Schedule } from "./schedule";

const prefs = () => JSON.parse(localStorage.getItem("shoji.prefs")!);

/** A daily task at midnight, made two days ago, so it's due now. */
const due = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s1",
  task: "Update the dependencies",
  repo: "/work/pricing-page",
  repeat: "day",
  time: "00:00",
  day: 1,
  tier: "balanced",
  created: Date.now() - 2 * 86_400_000,
  ...over,
});

describe("scheduled tasks", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("saves a task to repeat from Home and lists it in Threads", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("radio", { name: "Every week" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Day" }), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:30" } });
    fireEvent.change(task, { target: { value: "Write the release notes" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts).toEqual([]);
    expect(prefs().schedules).toMatchObject([
      { task: "Write the release notes", repo: "/work/pricing-page", repeat: "week", day: 5, time: "17:30" },
    ]);
    expect(screen.getByRole("heading", { name: "Scheduled" })).toBeTruthy();
    expect(screen.getByText("Every Friday at 17:30")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: 'Run "Write the release notes" on schedule' }));
    expect(prefs().schedules[0].paused).toBe(true);
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: 'Remove "Write the release notes"' }));
    expect(prefs().schedules).toEqual([]);
  });

  it("starts a task that's come due, once, without pausing after the plan", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({ repo: "/work/pricing-page", planFirst: true, schedules: [due()] }),
    );
    const fake = fakeBridge();
    // Opened, with the key and the stack read, before the first look.
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fake.calls.starts).toHaveLength(1);
    expect(fake.calls.starts[0]).toMatchObject({ task: "Update the dependencies", repo: "/work/pricing-page" });
    expect(fake.calls.starts[0].planOnly).toBeFalsy();
    expect(prefs().schedules[0].last).toBeGreaterThan(due().created);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fake.calls.starts).toHaveLength(1);
  });

  it("skips a time that could take the day past the daily limit, and says so", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({ repo: "/work/pricing-page", cap: 0.5, dailyLimit: 0.4, schedules: [due()] }),
    );
    const fake = fakeBridge();
    // Opened, with the key and the stack read, before the first look.
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fake.calls.starts).toEqual([]);
    expect(prefs().schedules[0].skipped).toBe("it could have taken the day past your $0.40 limit");
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect(screen.getByText("Skipped last time: it could have taken the day past your $0.40 limit")).toBeTruthy();
  });
});
