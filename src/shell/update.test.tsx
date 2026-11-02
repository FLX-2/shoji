import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { CHECK_AFTER, useUpdate } from "./useUpdate";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** Lets the check's timer fire and its answer arrive. */
async function waitForCheck() {
  await act(async () => {
    vi.advanceTimersByTime(CHECK_AFTER);
  });
  await act(async () => {});
}

describe("updating Shoji", () => {
  it("offers a newer release a little after opening, and installs it on Restart to update", async () => {
    const fake = fakeBridge();
    fake.release.update = { version: "0.1.1", notes: "Fixes." };
    render(<App bridge={fake.bridge} />);
    expect(fake.release.checks).toBe(0);
    await waitForCheck();
    expect(fake.release.checks).toBe(1);
    expect(screen.getByText("Shoji 0.1.1 is ready.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    });
    expect(fake.release.installs).toBe(1);
    expect(screen.getByText("Installing Shoji 0.1.1. Shoji opens again when it's done.")).toBeTruthy();
  });

  it("stays quiet when there's nothing newer", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await waitForCheck();
    expect(fake.release.checks).toBe(1);
    expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
  });

  it("never asks when Check for updates is off", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ checkUpdates: false }));
    const fake = fakeBridge();
    fake.release.update = { version: "0.1.1", notes: null };
    render(<App bridge={fake.bridge} />);
    await waitForCheck();
    expect(fake.release.checks).toBe(0);
    expect(screen.queryByText("Shoji 0.1.1 is ready.")).toBeNull();
  });

  it("sets the update aside until next time when the note is closed", async () => {
    const fake = fakeBridge();
    fake.release.update = { version: "0.1.1", notes: null };
    render(<App bridge={fake.bridge} />);
    await waitForCheck();
    fireEvent.click(document.querySelector(".toast .x")!);
    expect(screen.queryByText("Shoji 0.1.1 is ready.")).toBeNull();
  });

  it("says plainly when the install fails", async () => {
    const fake = fakeBridge();
    fake.release.update = { version: "0.1.1", notes: null };
    fake.release.installError = "Shoji couldn't install the update: no space left.";
    render(<App bridge={fake.bridge} />);
    await waitForCheck();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Shoji couldn't install the update: no space left.");
  });

  it("holds the offer while anything runs, since installing closes Shoji", async () => {
    const fake = fakeBridge();
    fake.release.update = { version: "0.1.1", notes: null };
    const { result, rerender } = renderHook(({ running }) => useUpdate(fake.bridge, true, running, () => {}), {
      initialProps: { running: true },
    });
    await waitForCheck();
    expect(result.current.note).toBeNull();
    rerender({ running: false });
    expect(result.current.note?.text).toBe("Shoji 0.1.1 is ready.");
  });

  it("lists the switch under Settings, Data", () => {
    render(<App bridge={fakeBridge().bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    expect(screen.getByText("Check for updates")).toBeTruthy();
  });
});
