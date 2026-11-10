import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { lastThreadProblem } from "./diagnostics";

describe("Copy diagnostics", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("copies versions, connections and the stack for a bug report, with no keys or account names", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    const fake = fakeBridge();
    fake.chatgpt.email = "bob@example.com";
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true, repo: "/work/pricing-page" }));
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    });
    const text = copied[0];
    expect(text).toMatch(/^Shoji \d+\.\d+\.\d+\n/);
    expect(text).toContain("Anthropic key: saved");
    expect(text).toContain("OpenAI key: none");
    expect(text).toContain("ChatGPT: signed-in");
    expect(text).toContain("Stack: scout claude-haiku-5-5 (low)");
    expect(text).toContain("Last error: none");
    expect(text).not.toContain("bob@example.com");
    expect(text).not.toContain("pricing-page");
    expect(screen.getByText("Copied diagnostics")).toBeTruthy();
  });

  it("finds the last thing that went wrong in a thread", () => {
    const turn = (extra: object) => ({ ask: "", kind: "task" as const, events: [], ...extra });
    const thread = (turns: object[]) => ({ task: "", repo: "", stack: {} as never, cap: 1, turns }) as never;
    expect(lastThreadProblem([])).toBeNull();
    expect(
      lastThreadProblem([
        thread([turn({ error: "Add your OpenAI API key in Settings first." })]),
        thread([
          turn({
            events: [{ type: "result", result: { status: "failed", reason: "Ollama doesn't have qwen3." } }],
            exit: { run: 2, code: 0, error: "" },
          }),
        ]),
      ]),
    ).toBe("Ollama doesn't have qwen3.");
  });
});
