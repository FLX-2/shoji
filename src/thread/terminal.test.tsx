import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

// xterm draws on a canvas jsdom doesn't have, so a stand-in keeps what it's given.
vi.mock("@xterm/xterm", () => {
  class Terminal {
    static last: Terminal;
    cols = 80;
    rows = 24;
    written: string[] = [];
    typed?: (data: string) => void;
    constructor() {
      Terminal.last = this;
    }
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    clear() {
      this.written = [];
    }
    write(data: string) {
      this.written.push(data);
    }
    onData(handler: (data: string) => void) {
      this.typed = handler;
      return { dispose() {} };
    }
  }
  return { Terminal };
});
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

interface Stand {
  written: string[];
  typed?: (data: string) => void;
}
const shown = () => (Terminal as unknown as { last: Stand }).last;

describe("the thread's Terminal", () => {
  beforeEach(() =>
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false })),
  );
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const view = (name: string) =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name }));
    });

  it("opens a shell in the thread's copy that keeps going while the person looks elsewhere", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    await view("Terminal");
    // The terminal loads the first time it opens.
    await waitFor(() => expect(fake.calls.terminals).toHaveLength(1));
    expect(fake.calls.terminals).toEqual([{ dir: "/data/worktrees/thread", cols: 80, rows: 24 }]);

    await fake.terminalSays(1, "~/thread $ ");
    expect(shown().written.join("")).toBe("~/thread $ ");
    shown().typed!("ls\r");
    expect(fake.calls.typed).toEqual([{ terminal: 1, data: "ls\r" }]);
    await fake.terminalSays(1, "src\r\n");

    // Back from Conversation, the same shell is drawn again with what it printed.
    await view("Conversation");
    await view("Terminal");
    expect(fake.calls.terminals).toHaveLength(1);
    expect(shown().written.join("")).toBe("~/thread $ src\r\n");

    await fake.terminalEnds(1);
    expect(screen.getByText("The shell ended.")).toBeTruthy();
    await view("Start a new shell");
    expect(fake.calls.terminals).toHaveLength(2);
  });
});
