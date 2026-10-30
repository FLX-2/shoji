import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { matchFiles, mentionAt } from "./mention";

const FILES = ["README.md", "src/App.tsx", "src/app/routes.ts", "src/styles/app.css", "docs/mapping.md"];

describe("finding a file after @", () => {
  it("knows when the caret is in a mention", () => {
    expect(mentionAt("Fix @src/Ap", 11)).toEqual({ start: 4, query: "src/Ap" });
    expect(mentionAt("(@rea", 5)).toEqual({ start: 1, query: "rea" });
    expect(mentionAt("Fix @src/App.tsx now", 20)).toBeNull();
    expect(mentionAt("mail me@home", 12)).toBeNull();
  });

  it("puts file names that start with the text first, then ones that have it, then folders", () => {
    expect(matchFiles(FILES, "app")).toEqual([
      "src/App.tsx",
      "src/styles/app.css",
      "docs/mapping.md",
      "src/app/routes.ts",
    ]);
    expect(matchFiles(FILES, "")).toHaveLength(5);
    expect(matchFiles(FILES, "zzz")).toEqual([]);
  });
});

describe("@ in the task box", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("offers the project's files and puts the picked one in the task", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    fake.project.files = FILES;
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    const task = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    const type = (value: string) => fireEvent.change(task, { target: { value, selectionStart: value.length } });

    type("Restyle @app");
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("App.tsxsrc");
    fireEvent.keyDown(task, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");

    // Enter picks the file rather than sending the task.
    fireEvent.keyDown(task, { key: "Enter" });
    expect(task.value).toBe("Restyle @src/styles/app.css ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(fake.calls.starts).toEqual([]);

    type("Restyle @src/styles/app.css to match @READ");
    fireEvent.keyDown(task, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].task).toBe("Restyle @src/styles/app.css to match @READ");
  });
});
