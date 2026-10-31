import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
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

  it("walks through stack and project, saving only what changed", async () => {
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
    // Look isn't a step; it's in Settings.
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
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
    expect(screen.queryByText("Project notes")).toBeNull();
  });

  /** Opens setup's Project step with a project already chosen. */
  async function projectStep(fake = fakeBridge()) {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await click("Run setup again");
    await click("Set up Shoji");
    await click("Continue");
    await click("Continue");
    await screen.findByText("Project notes");
    return fake;
  }

  it("has Scout write the project's notes when asked, and shows what they cost", async () => {
    const fake = await projectStep();
    expect(screen.getByText(/Haiku 5.5 reads the project once and writes SHOJI.md/)).toBeTruthy();
    expect(fake.calls.notes).toEqual([]);
    await click("Write notes");
    expect(fake.calls.notes).toEqual([{ repo: "/work/pricing-page", stack: STACKS.balanced, cap: 0.05, privateFiles: DEFAULT_PRIVATE }]);
    expect(screen.getByText("Haiku 5.5 is reading pricing-page.")).toBeTruthy();
    expect(document.querySelector(".app")!.getAttribute("data-state")).toBe("running");

    const call = {
      role: "scout",
      step: "notes",
      model: "claude-haiku-5-5",
      effort: "low",
      inputTokens: 9000,
      outputTokens: 600,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      cost: 0.0012,
      seconds: 2,
    } as const;
    fake.emitNotes(
      { type: "call", call },
      { type: "notes", result: { status: "ready", notes: "# Pricing page", cost: 0.0012 } },
    );
    fake.exit(0);
    expect(screen.getByText(/Written to SHOJI.md for \$0.0012/)).toBeTruthy();
    expect(screen.getByText("written")).toBeTruthy();
    expect(document.querySelector(".app")!.getAttribute("data-state")).toBe("idle");
  });

  it("keeps notes the project already has", async () => {
    const fake = fakeBridge();
    fake.files.hasNotes = true;
    await projectStep(fake);
    await click("Write notes");
    expect(screen.getByText(/already has a SHOJI.md/)).toBeTruthy();
    expect(document.querySelector(".app")!.getAttribute("data-state")).toBe("idle");
  });

  it("says why the notes stopped, and offers to try again", async () => {
    const fake = await projectStep();
    await click("Write notes");
    fake.emitNotes({
      type: "notes",
      result: {
        status: "stopped",
        reason: "Stopped at $0.05: the next call could pass the $0.05 limit.",
        notes: "",
        cost: 0.05,
      },
    });
    fake.exit(1);
    expect(screen.getByText(/the next call could pass/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
