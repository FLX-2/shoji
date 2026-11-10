import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFound, MODELS, NAMED } from "../../runtime/src/models";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { planStack } from "./chatgpt";
import { parseLock } from "./lock";
import { modelGroups, priceLine } from "./ModelPick";

const click = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

const openModels = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
  await act(async () => {});
};

describe("Sign in with ChatGPT", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    applyFound("chatgpt", {});
    applyFound(NAMED, {});
  });

  it("signs in from Settings, says once that runs use the plan, and signs out", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await openModels();
    expect(screen.getByText(/With ChatGPT Plus or Pro, OpenAI's models run on your plan/)).toBeTruthy();

    await click("Continue with ChatGPT");
    expect(fake.chatgpt.signIns).toBe(1);
    expect(screen.getByText("Signed in as bob@example.com. GPT-5.5, GPT-5.5 mini, on your plan.")).toBeTruthy();
    expect(screen.getByText("You're using your ChatGPT plan.")).toBeTruthy();
    await click("Got it");
    expect(screen.queryByText("You're using your ChatGPT plan.")).toBeNull();

    await click("Manage usage");
    expect(fake.chatgpt.usageOpened).toBe(1);
    await click("Sign out");
    expect(fake.chatgpt.signOuts).toBe(1);
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
  });

  it("says what went wrong when the sign-in doesn't finish", async () => {
    const fake = fakeBridge();
    fake.chatgpt.signInError = "The sign-in wasn't finished in five minutes.";
    render(<App bridge={fake.bridge} />);
    await openModels();
    await click("Continue with ChatGPT");
    expect(screen.getByText("The sign-in wasn't finished in five minutes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
  });

  it("lets setup go on with a ChatGPT plan alone, on a stack that runs on it", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await screen.findByRole("region", { name: "Setup" });
    await click("Set up Shoji");
    expect(screen.getByText("Connect a provider to go on")).toBeTruthy();
    await click("Continue with ChatGPT");
    expect(screen.getByText("ChatGPT is connected")).toBeTruthy();
    await click("Continue");

    const stacks = within(screen.getByRole("radiogroup", { name: "Starting stack" }));
    expect(stacks.getAllByRole("radio").map((r) => r.textContent)).toEqual(["On my ChatGPT plan"]);
    expect(screen.getByText("GPT-5.5 plans and builds and GPT-5.5 mini scouts and reviews.")).toBeTruthy();
    await click("Continue");
    expect(parseLock(fake.files.stackLock!).versions.at(-1)!.stack).toEqual(
      planStack(["chatgpt/gpt-5.5", "chatgpt/gpt-5.5-mini"]),
    );
  });

  it("asks for a sign-in on Home when the stack uses ChatGPT and nobody is signed in", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: planStack(["chatgpt/gpt-5.5"]) }] });
    localStorage.setItem("shoji.chatgpt", JSON.stringify([{ slug: "gpt-5.5", displayName: "GPT-5.5" }]));
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.getByText(/Your stack uses ChatGPT's models/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT in Settings" })).toBeTruthy();
  });

  it("runs on the plan once signed in, without an Anthropic key", async () => {
    const fake = fakeBridge({ saved: false, fromEnv: false });
    fake.chatgpt.email = "bob@example.com";
    fake.files.stackLock = JSON.stringify({ versions: [{ at: 1, stack: planStack(["chatgpt/gpt-5.5"]) }] });
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    expect(screen.queryByText(/needs your Anthropic API key/)).toBeNull();
    expect(screen.queryByText(/Your stack uses ChatGPT's models/)).toBeNull();
  });

  it("lists plan models under ChatGPT, on the plan, and gives one size every step", () => {
    applyFound("chatgpt", {
      "chatgpt/gpt-5.5": { label: "GPT-5.5", input: 0, output: 0, cacheRead: 0, billing: "plan" },
    });
    expect(modelGroups().map((g) => g.family)).toContain("ChatGPT");
    expect(priceLine("chatgpt/gpt-5.5")).toBe("Using your ChatGPT plan");
    expect(MODELS["chatgpt/gpt-5.5"].billing).toBe("plan");
    const stack = planStack(["chatgpt/gpt-5.5"]);
    expect(stack.scout.model).toBe("chatgpt/gpt-5.5");
    expect(stack.plan.model).toBe("chatgpt/gpt-5.5");
  });
});
