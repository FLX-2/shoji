import { describe, expect, it } from "vitest";
import { providerOf, type ModelId } from "../../runtime/src/models";
import { STACKS } from "../../runtime/src/stack";
import { guessRoute, modelNamed, readMessage, routeMark, stackFor, type Move, type Place } from "./route";

const claude = (id: ModelId) => providerOf(id) === "anthropic";
const reading = (place: Place, can: Move[] = []) => ({ place, can: (m: Move) => can.includes(m), reaches: claude });

describe("routing a message", () => {
  it("guesses the route from the words and where the thread stands", () => {
    expect(guessRoute("Add a FAQ page with five questions", "home")).toBe("task");
    expect(guessRoute("Rename the Save button to Keep", "home")).toBe("quick");
    expect(guessRoute("Fix the typo in the footer", "home")).toBe("quick");
    expect(guessRoute("What does the pricing page load?", "home")).toBe("answer");
    expect(guessRoute("Make the badge smaller", "work")).toBe("change");
    expect(guessRoute("Review it again", "work")).toBe("review");
    expect(guessRoute("Try a different approach with CSS grid", "work")).toBe("replan");
    expect(guessRoute("Keep the monthly price visible", "planned")).toBe("replan");
    expect(guessRoute("Make the badge smaller", "fresh")).toBe("change");
    // "Can you…" asks for work, not an answer.
    expect(guessRoute("Can you make it blue?", "work")).toBe("change");
  });

  it("reads a short next step said in words as its chip, only where it can happen", () => {
    expect(readMessage("looks good, commit it", reading("work", ["commit"]))).toEqual({ move: "commit" });
    expect(readMessage("Build it.", reading("planned", ["build"]))).toEqual({ move: "build" });
    expect(readMessage("keep going", reading("work", ["keep-going"]))).toEqual({ move: "keep-going" });
    // A move the thread can't make is just words.
    expect(readMessage("commit it", reading("work"))).toEqual({ route: { kind: "change" }, text: "commit it" });
    // So is a long message that happens to start like one.
    const long = "commit it but first make sure the footer links all open in a new tab";
    expect(readMessage(long, reading("work", ["commit"]))).toEqual({ route: { kind: "change" }, text: long });
    // A route picked in the menu means the words are a message, not a move.
    expect(readMessage("build it", reading("planned", ["build"]), "answer")).toEqual({
      route: { kind: "answer" },
      text: "build it",
    });
  });

  it("hands a message to a seat named first, on a model named with it", () => {
    expect(readMessage("@review on opus: is the toggle right?", reading("work"))).toEqual({
      route: { kind: "review", model: "claude-opus-5-5" },
      text: "is the toggle right?",
    });
    expect(readMessage("@plan add a yearly price", reading("home"))).toEqual({
      route: { kind: "task" },
      text: "add a yearly price",
    });
    expect(readMessage("@build rename the button", reading("home"))).toEqual({
      route: { kind: "quick" },
      text: "rename the button",
    });
    expect(readMessage("@scout", reading("work"))).toEqual({ route: { kind: "answer" }, text: "@scout" });
    // The seat wins over a route picked in the menu, and over a move.
    expect(readMessage("@plan build it", reading("planned", ["build"]), "answer")).toMatchObject({ route: { kind: "replan" } });
    // A model the person can't reach is left out, and the seat's own model runs.
    expect(readMessage("@build with gpt: make it blue", reading("work"))).toEqual({
      route: { kind: "change" },
      text: "make it blue",
    });
  });

  it("finds the newest model the person can reach by a few words of its name", () => {
    expect(modelNamed("opus", claude)).toBe("claude-opus-5-5");
    expect(modelNamed("Sonnet 5.5", claude)).toBe("claude-sonnet-5-5");
    expect(modelNamed("", claude)).toBeUndefined();
    expect(modelNamed("opus", () => false)).toBeUndefined();
  });

  it("marks the route with the seat it leads with, and runs that seat on the named model", () => {
    const stack = STACKS.balanced;
    expect(routeMark({ kind: "change" }, stack)).toBe("Change · Build on Sonnet 5.5");
    expect(routeMark({ kind: "answer", model: "claude-opus-5-5" }, stack)).toBe("Answer · Scout on Opus 5.5");
    expect(stackFor({ kind: "change" }, stack)).toBe(stack);
    const once = stackFor({ kind: "review", model: "claude-opus-5-5" }, stack);
    expect(once.review).toEqual({ ...stack.review, model: "claude-opus-5-5" });
    expect(once.build).toBe(stack.build);
  });
});
