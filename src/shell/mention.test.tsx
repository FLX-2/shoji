import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { commandAt, matchCommands, matchFiles, mentionAt } from "./mention";

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

const COMMANDS = [
  { name: "fix-issue", description: "Fix a numbered issue", hint: "<number>" },
  { name: "review", description: "Review the branch", hint: "" },
  { name: "prefix", description: "Add a prefix", hint: "" },
];

describe("finding a command after /", () => {
  it("knows when the caret is in a command's name at the start", () => {
    expect(commandAt("/fi", 3)).toEqual({ query: "fi" });
    expect(commandAt("/", 1)).toEqual({ query: "" });
    expect(commandAt("/fix-issue 12", 13)).toBeNull();
    expect(commandAt("Fix /fi", 7)).toBeNull();
  });

  it("puts names that start with the text first", () => {
    expect(matchCommands(COMMANDS, "re").map((c) => c.name)).toEqual(["review", "prefix"]);
    expect(matchCommands(COMMANDS, "zzz")).toEqual([]);
  });
});

describe("/ in the task box", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("offers the project's commands and starts the task with the picked one", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    fake.project.files = FILES;
    fake.project.commands = COMMANDS;
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    const task = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    const type = (value: string) => fireEvent.change(task, { target: { value, selectionStart: value.length } });

    type("/");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "/fix-issue <number>Fix a numbered issue",
      "/prefixAdd a prefix",
      "/reviewReview the branch",
    ]);
    type("/fi");
    fireEvent.keyDown(task, { key: "Tab" });
    expect(task.value).toBe("/fix-issue ");
    expect(screen.queryByRole("listbox")).toBeNull();

    // A path isn't a command, so nothing is offered and the text goes as typed.
    type("/etc/hosts is wrong");
    expect(screen.queryByRole("listbox")).toBeNull();

    // The task goes as typed; the runtime puts the command's text in.
    type("/fix-issue 12");
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].task).toBe("/fix-issue 12");
  });
});
