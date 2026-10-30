import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
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

  it("keeps the private files the person lists from every run, and can go back to the defaults", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    const box = screen.getByRole("textbox", { name: /Private files/ });
    expect((box as HTMLTextAreaElement).value).toBe(DEFAULT_PRIVATE.join("\n"));
    expect(screen.queryByRole("button", { name: "Use the defaults" })).toBeNull();

    fireEvent.change(box, { target: { value: ".env\n\n  secrets/  \n" } });
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).privateFiles).toEqual([".env", "secrets/"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].privateFiles).toEqual([".env", "secrets/"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Use the defaults" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).privateFiles).toEqual(DEFAULT_PRIVATE);
  });
});
