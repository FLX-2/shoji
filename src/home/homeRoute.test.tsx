import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { STACKS } from "../../runtime/src/stack";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

/** Home with the plan check on, so a full task pauses after its plan. */
async function home(prefs: object = {}) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", cap: 0.5, ...prefs }));
  const fake = fakeBridge();
  render(<App bridge={fake.bridge} />);
  const box = (await screen.findByRole("textbox", { name: "Task" })) as HTMLTextAreaElement;
  const type = (text: string) => fireEvent.change(box, { target: { value: text } });
  const send = async () => {
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
  };
  const mark = () => document.querySelector(".chip.route")?.textContent;
  return { fake, type, send, mark };
}

describe("routing from Home", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("takes the full route for a task, and checks the plan first", async () => {
    const { fake, type, send, mark } = await home();
    type("Add an annual toggle to the pricing cards");
    expect(mark()).toBe("Full task · Plan on Opus 5.5");
    expect(screen.getByRole("button", { name: "Check the plan first" })).toBeTruthy();
    await send();
    expect(fake.calls.starts[0].planOnly).toBe(true);
    expect(fake.calls.starts[0].quick).toBeUndefined();
  });

  it("skips the plan for a small edit", async () => {
    const { fake, type, send, mark } = await home();
    type("Rename the Save button to Keep");
    expect(mark()).toBe("Quick change · Build on Sonnet 5.5");
    // A quick change has no plan to check.
    expect(screen.queryByRole("button", { name: "Check the plan first" })).toBeNull();
    await send();
    expect(fake.calls.starts[0]).toMatchObject({ task: "Rename the Save button to Keep", quick: true });
    expect(fake.calls.starts[0].planOnly).toBeUndefined();
  });

  it("answers a question without changing anything", async () => {
    const { fake, type, send, mark } = await home();
    type("Where is the pricing data loaded?");
    expect(mark()).toBe("Answer · Scout on Haiku 5.5");
    await send();
    expect(fake.calls.starts[0]).toMatchObject({ task: "Where is the pricing data loaded?", answer: true });
    expect(fake.calls.starts[0].planOnly).toBeUndefined();
    await act(async () => {
      fake.emit(
        { type: "step", step: "answer", role: "scout", model: "claude-haiku-5-5", status: "running" },
        { type: "step", step: "answer", role: "scout", model: "claude-haiku-5-5", status: "done", output: "In api.ts." },
        {
          type: "result",
          result: {
            status: "answered",
            plan: "",
            diff: "",
            review: "",
            checks: [],
            escalated: false,
            cost: 0.01,
            costByRole: { scout: 0.01, plan: 0, build: 0, review: 0 },
          },
        },
      );
      fake.exit(0);
    });
    expect(screen.getByText("In api.ts.")).toBeTruthy();
    // An answer has nothing to try again.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("takes the route picked in the menu, and only Shoji's guess when Settings allows it", async () => {
    const { fake, type, send, mark } = await home({ routeForMe: false });
    type("Rename the Save button to Keep");
    // Without guessing, every task takes the full route.
    expect(mark()).toBe("Full task · Plan on Opus 5.5");
    fireEvent.click(document.querySelector(".chip.route")!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Quick change/ }));
    expect(mark()).toBe("Quick change · Build on Sonnet 5.5");
    await send();
    expect(fake.calls.starts[0].quick).toBe(true);
  });

  it("starts with a named seat on a named model, for that run only", async () => {
    const { fake, type, send, mark } = await home({ planFirst: false });
    type("@plan on sonnet: add a FAQ page");
    expect(mark()).toBe("Full task · Plan on Sonnet 5.5");
    await send();
    expect(fake.calls.starts[0]).toMatchObject({ task: "add a FAQ page", ask: "add a FAQ page" });
    expect(fake.calls.starts[0].stack).toEqual({
      ...STACKS.balanced,
      plan: { ...STACKS.balanced.plan, model: "claude-sonnet-5-5" },
    });
  });
});
