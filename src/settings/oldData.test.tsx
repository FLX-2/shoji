import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { formatBytes } from "./size";

async function openData(oldBytes: number) {
  const fake = fakeBridge();
  fake.files.oldBytes = oldBytes;
  localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
  render(<App bridge={fake.bridge} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
  });
  return fake;
}

describe("Clear old data", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("says how much it would free, and clears only once the person confirms", async () => {
    const fake = await openData(412_300_000);
    fireEvent.click(screen.getByRole("button", { name: "Clear 412 MB" }));
    expect(screen.getByText("Clear 412 MB for good?")).toBeTruthy();
    expect(fake.calls.cleared).toEqual([]);

    // Keep leaves everything where it is.
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(fake.calls.cleared).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear 412 MB" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    expect(fake.calls.cleared).toEqual([412_300_000]);
    expect(screen.getByText("Cleared 412 MB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Clear/ })).toBeNull();
  });

  it("offers nothing to press when there is nothing old", async () => {
    await openData(0);
    expect(screen.getByText("Nothing to clear")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Clear/ })).toBeNull();
  });

  it("writes sizes as a file manager does", () => {
    expect(formatBytes(1)).toBe("1 KB");
    expect(formatBytes(412_300)).toBe("412 KB");
    expect(formatBytes(999_700)).toBe("1.0 MB");
    expect(formatBytes(38_400_000)).toBe("38 MB");
    expect(formatBytes(1_240_000_000)).toBe("1.2 GB");
    expect(formatBytes(9_960_000_000)).toBe("10 GB");
  });
});
