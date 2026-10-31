import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyCatalog, BUILT_IN } from "../../runtime/src/models";
import { ModelPick, modelGroups, priceLine } from "./ModelPick";

/** A catalog with more models than three, as it will hold once new ones come out. */
const GROWN = {
  updated: "2027-03-01",
  models: {
    "claude-opus-5": { label: "Opus 5", input: 5, output: 25, cacheRead: 0.5 },
    "claude-sonnet-6": { label: "Sonnet 6", input: 3, output: 15, cacheRead: 0.3 },
    "claude-haiku-5": { label: "Haiku 5", input: 0.8, output: 4, cacheRead: 0.08 },
    "claude-fable-5-1": { label: "Fable 5.1", input: 10, output: 50, cacheRead: 1 },
    "claude-sonnet-5": { label: "Sonnet 5", input: 3, output: 15, cacheRead: 0.3 },
    "claude-opus-4-8": { label: "Opus 4.8", input: 5, output: 25, cacheRead: 0.5 },
  },
};

describe("choosing a role's model", () => {
  afterEach(() => {
    cleanup();
    applyCatalog(null);
  });

  it("lists the built-in models flat, dearest first, with their prices", () => {
    expect(modelGroups().map((g) => g.ids)).toEqual([["claude-opus-5-5"], ["claude-sonnet-5-5"], ["claude-haiku-5-5"]]);
    expect(priceLine("claude-opus-5-5")).toBe("$4 in, $20 out");
    expect(priceLine("claude-haiku-5-5")).toBe("$0.10 in, $0.50 out");

    const pick = vi.fn();
    render(<ModelPick label="Build model" value="claude-sonnet-5-5" onPick={pick} />);
    const button = screen.getByRole("button", { name: "Build model" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const list = screen.getByRole("listbox", { name: "Build model" });
    // Three models, each its own family, so no family names and no box to find one.
    expect(within(list).queryAllByRole("group")).toEqual([]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Opus 5.5$4 in, $20 out", "Sonnet 5.5$2 in, $10 out", "Haiku 5.5$0.10 in, $0.50 out"]);
    expect(
      within(list)
        .getByRole("option", { name: /Sonnet/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("moves through the list with the keyboard, and Escape leaves the pick as it was", () => {
    const pick = vi.fn();
    render(<ModelPick label="Plan model" value="claude-opus-5-5" onPick={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "Plan model" }));
    const list = screen.getByRole("listbox", { name: "Plan model" });
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toContain("claude-haiku-5-5");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(pick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Plan model" }));

    fireEvent.click(screen.getByRole("button", { name: "Plan model" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("claude-haiku-5-5");
  });

  it("groups a longer list by family, newest first in each, and finds a model by name", () => {
    applyCatalog(GROWN);
    expect(modelGroups().map((g) => [g.family, g.ids])).toEqual([
      ["Fable", ["claude-fable-5-1"]],
      ["Opus", ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]],
      ["Sonnet", ["claude-sonnet-6", "claude-sonnet-5-5", "claude-sonnet-5"]],
      ["Haiku", ["claude-haiku-5-5", "claude-haiku-5"]],
    ]);

    const pick = vi.fn();
    render(<ModelPick label="Review model" value="claude-haiku-5-5" onPick={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "Review model" }));
    const list = screen.getByRole("listbox", { name: "Review model" });
    expect(
      within(list)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-labelledby") && g.previousSibling?.textContent),
    ).toEqual(["Fable", "Opus", "Sonnet", "Haiku"]);

    const find = screen.getByRole("combobox", { name: "Find a model for review" });
    expect(document.activeElement).toBe(find);
    fireEvent.change(find, { target: { value: "sonnet" } });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.querySelector("b")?.textContent),
    ).toEqual(["Sonnet 6", "Sonnet 5.5", "Sonnet 5"]);
    fireEvent.keyDown(find, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("claude-sonnet-6");
  });

  it("keeps a built-in model the catalog leaves out", () => {
    applyCatalog({ updated: "2027-03-01", models: {} });
    expect(Object.keys(BUILT_IN).every((id) => modelGroups().some((g) => g.ids.includes(id)))).toBe(true);
  });
});
