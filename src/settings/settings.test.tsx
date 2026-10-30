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

  it("lists commands always allowed in a project, and asks about one again once it's taken off", async () => {
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({ allowedCommands: { "/work/pricing-page": ["npm install", "npx prettier --write ."] } }),
    );
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    expect(screen.getByText("npm install")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Ask again" })[0]);
    expect(screen.queryByText("npm install")).toBeNull();
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands).toEqual({
      "/work/pricing-page": ["npx prettier --write ."],
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands).toEqual({});
  });
});
