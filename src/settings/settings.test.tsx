import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

describe("Settings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("forgets the key only after asking", async () => {
    const fake = fakeBridge({ saved: true, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Forget" }));
    expect(fake.calls.forgot).toBe(0);
    expect(screen.getByText("Forget the saved key?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Forget the saved key?")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Forget" }).length).toBe(1);

    // Ask again, then confirm.
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(screen.getByText("Forget the saved key?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    });
    expect(fake.calls.forgot).toBe(1);
    expect(await screen.findByPlaceholderText("sk-ant-…")).toBeTruthy();
  });
});
