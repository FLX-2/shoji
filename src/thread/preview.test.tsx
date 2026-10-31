import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { isLocal } from "./PreviewView";
import { guessCommand, localUrl } from "./useServers";

describe("the preview's address", () => {
  it("is this computer's dev server only", () => {
    expect(isLocal("http://localhost:5173")).toBe(true);
    expect(isLocal("http://127.0.0.1:3000/pricing")).toBe(true);
    expect(isLocal("https://example.com")).toBe(false);
    expect(isLocal("localhost:5173")).toBe(false);
    expect(isLocal("file:///etc/passwd")).toBe(false);
  });
});

describe("a dev server's output", () => {
  it("gives the local address the server printed, colours and all", () => {
    expect(
      localUrl("  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m"),
    ).toBe("http://localhost:5174/");
    expect(localUrl("- Local:        http://localhost:3000")).toBe("http://localhost:3000");
    expect(localUrl("Server running at http://127.0.0.1:8000.")).toBe("http://127.0.0.1:8000");
    expect(localUrl("  Network: http://192.168.1.4:5173/")).toBeUndefined();
    expect(localUrl("compiled in 120 ms")).toBeUndefined();
  });

  it("guesses the command from the project's package manager", () => {
    expect(guessCommand(["package.json", "pnpm-lock.yaml"])).toBe("pnpm dev");
    expect(guessCommand(["package.json", "yarn.lock"])).toBe("yarn dev");
    expect(guessCommand(["bun.lock", "package.json"])).toBe("bun run dev");
    expect(guessCommand(["package.json"])).toBe("npm run dev");
    expect(guessCommand(["manage.py"])).toBe("");
  });
});

describe("Preview in a thread", () => {
  let answering = true;
  beforeEach(() => {
    answering = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (answering ? new Response() : Promise.reject(new TypeError("refused")))),
    );
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function openPreview(fake = fakeBridge()) {
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    });
    return fake;
  }

  it("shows the dev server at the width picked, and remembers the project's address", async () => {
    await openPreview();
    const frame = screen.getByTitle("Preview at 1280 px") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("http://localhost:5173");

    fireEvent.click(screen.getByRole("radio", { name: "360 px" }));
    expect(screen.getByTitle("Preview at 360 px").style.width).toBe("360px");

    const address = screen.getByRole("textbox", { name: "Dev server address" });
    fireEvent.change(address, { target: { value: "http://localhost:3000" } });
    await act(async () => {
      fireEvent.submit(address);
    });
    expect(screen.getByTitle("Preview at 360 px").getAttribute("src")).toBe("http://localhost:3000");
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).previewUrls).toEqual({
      "/work/pricing-page": "http://localhost:3000",
    });
  });

  it("says when nothing answers, and won't frame a page from elsewhere", async () => {
    answering = false;
    await openPreview();
    expect(screen.getByText(/^Nothing answers at http:\/\/localhost:5173\./)).toBeTruthy();
    expect(screen.queryByTitle(/^Preview at/)).toBeNull();

    answering = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    });
    expect(screen.getByTitle("Preview at 1280 px")).toBeTruthy();

    const address = screen.getByRole("textbox", { name: "Dev server address" });
    fireEvent.change(address, { target: { value: "https://example.com" } });
    await act(async () => {
      fireEvent.blur(address);
    });
    expect(screen.getByText(/previews this computer's dev server only/)).toBeTruthy();
    expect(screen.queryByTitle(/^Preview at/)).toBeNull();
  });

  it("starts the dev server in the thread's copy and shows the address it prints", async () => {
    answering = false;
    const fake = fakeBridge();
    fake.project.files = ["package.json", "pnpm-lock.yaml", "src/App.tsx"];
    await openPreview(fake);
    const command = screen.getByRole("textbox", { name: "Dev server command" }) as HTMLInputElement;
    expect(command.value).toBe("pnpm dev");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start dev server" }));
    });
    expect(fake.calls.servers).toEqual([{ dir: "/data/worktrees/thread", command: "pnpm dev" }]);
    expect(screen.getByText("Starting pnpm dev in this thread's copy…")).toBeTruthy();

    answering = true;
    await fake.serverSays(
      1,
      "  VITE v6.0.0  ready in 300 ms",
      "  ➜  Local:   http://localhost:\u001b[1m5174\u001b[22m/",
    );
    await act(async () => {});
    expect(screen.getByTitle("Preview at 1280 px").getAttribute("src")).toBe("http://localhost:5174/");
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).devCommands).toEqual({ "/work/pricing-page": "pnpm dev" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop server" }));
    });
    expect(fake.calls.stoppedServers).toEqual([1]);
    answering = false;
    await fake.serverSays(1, "Error: something broke");
    await fake.serverExits(1, 1);
    await act(async () => {});
    expect(screen.getByText(/^The dev server stopped\. Nothing answers at http:\/\/localhost:5173\./)).toBeTruthy();
    expect(screen.getByText(/Error: something broke/)).toBeTruthy();
  });
});
