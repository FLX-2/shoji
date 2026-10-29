import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import { parseLock } from "../stack/lock";
import { fakeBridge } from "../test/fakeBridge";

const prefs = () => JSON.parse(localStorage.getItem("shoji.prefs") ?? "{}");

describe("first-run setup", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function open(fake = fakeBridge({ saved: false, fromEnv: false })) {
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    return fake;
  }

  const click = (name: string | RegExp) =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });

  it("opens on the first run, with the rail put away", async () => {
    await open();
    expect(screen.getByText("The right model for every step.")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("stays away for someone whose key is already saved", async () => {
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Setup" })).toBeNull();
  });

  it("goes on only once a key is saved, and keeps going after", async () => {
    const fake = await open();
    await click("Set up Shoji");
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-test" } });
    await click("Connect");
    expect(fake.calls.savedKeys).toEqual(["sk-ant-test"]);
    // The key is saved, so this is no longer a first run, but setup stays until it's finished.
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
  });

  it("offers a key found in the shell, and keeps it only when asked", async () => {
    const fake = await open(fakeBridge({ saved: false, fromEnv: true }));
    await click("Set up Shoji");
    expect(screen.getByText("A key was found in your shell")).toBeTruthy();
    expect(fake.calls.savedKeys).toEqual([]);
    await click("Use it");
    expect(fake.calls.savedKeys).toEqual(["(from the shell)"]);
    expect(screen.queryByText("A key was found in your shell")).toBeNull();
  });

  it("walks through stack, project and look, saving only what changed", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    // With a key already saved, setup comes from Settings.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await click("Run setup again");
    await click("Set up Shoji");
    await click("Continue");

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Starting stack" })).getByRole("radio", { name: "Haiku" }),
    );
    expect(screen.getByText("Haiku 5.5 takes every step.")).toBeTruthy();
    expect(fake.calls.lockWrites).toEqual([]);
    await click("Continue");
    expect(parseLock(fake.files.stackLock!).versions.map((v) => v.stack)).toEqual([STACKS.haiku]);

    await click("Open a folder…");
    expect(prefs().repo).toBe("/work/pricing-page");
    expect(screen.getByRole("button", { name: /pricing-page/ }).getAttribute("aria-pressed")).toBe("true");
    await click("Continue");

    fireEvent.click(screen.getByRole("switch", { name: "Interface motion" }));
    expect(prefs().motion).toBe(false);
    await click("Start using Shoji");
    expect(prefs().setupDone).toBe(true);
    expect(screen.queryByRole("region", { name: "Setup" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
  });

  it("says when a folder isn't a git repository", async () => {
    const fake = fakeBridge({ saved: true, fromEnv: false });
    fake.bridge.changes = async () => {
      throw new Error("not a git repository");
    };
    render(<App bridge={fake.bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await click("Run setup again");
    await click("Set up Shoji");
    await click("Continue");
    await click("Continue");
    await click("Open a folder…");
    expect(screen.getByText(/isn't a git repository/)).toBeTruthy();
  });
});
