import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RuntimeEvent } from "../../runtime/src/events";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const SONNET = "claude-sonnet-5-5";
const build: RuntimeEvent = { type: "step", step: "build", role: "build", model: SONNET, status: "running" };
const edit = (target: string): RuntimeEvent => ({ type: "tool", step: "build", tool: "write_file", target });
const look: RuntimeEvent = { type: "tool", step: "build", tool: "look_at_page", target: "/pricing at 1280px" };

const DIFF = `diff --git a/src/Card.tsx b/src/Card.tsx
--- a/src/Card.tsx
+++ b/src/Card.tsx
@@ -1 +1 @@
-export const price = plan.monthly;
+export const price = plan.annual / 12;
diff --git a/src/Badge.tsx b/src/Badge.tsx
--- a/src/Badge.tsx
+++ b/src/Badge.tsx
@@ -1 +1,2 @@
 export const Badge = () => null;
+export const label = "Save 20%";
`;

const toggle = () => screen.getByRole("button", { name: "Side panel" });
const shown = () => screen.queryByRole("tabpanel")?.getAttribute("aria-label") ?? null;

async function startThread(prefs: object = {}) {
  localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false, ...prefs }));
  const fake = fakeBridge();
  fake.project.diff = DIFF;
  render(<App bridge={fake.bridge} />);
  const task = await screen.findByRole("textbox", { name: "Task" });
  fireEvent.change(task, { target: { value: "Add annual pricing" } });
  await act(async () => {
    fireEvent.keyDown(task, { key: "Enter" });
  });
  await fake.emit(build);
  return fake;
}

describe("the thread's side panel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("stays closed until something happens, and its toggle keeps Code, Preview and Terminal as tabs", async () => {
    await startThread();
    expect(shown()).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle());
    });
    const tabs = within(screen.getByRole("tablist", { name: "Side panel" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+ files?/, ""))).toEqual(["Code", "Preview", "Terminal"]);
    expect(shown()).toBe("Code");
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(shown()).toBe("Preview");
    // Closed and opened again, it shows the tab it showed last.
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(shown()).toBeNull();
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(shown()).toBe("Preview");
  });

  it("opens on Code at the file Shoji edits, and stays shut for the turn once the person closes it", async () => {
    const fake = await startThread();
    await fake.emit(edit("src/Card.tsx"));
    await act(async () => {});
    expect(shown()).toBe("Code");
    expect(screen.getByRole("region", { name: "src/Card.tsx" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(toggle());
    });
    await fake.emit(edit("src/Badge.tsx"), look);
    expect(shown()).toBeNull();
  });

  it("opens on Preview when Shoji looks at a page, but never pulls the person off the tab they're on", async () => {
    const fake = await startThread();
    await fake.emit(look);
    expect(shown()).toBe("Preview");
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    await fake.emit(edit("src/Card.tsx"), look);
    expect(shown()).toBe("Terminal");
  });

  it("opens on Preview when the dev server starts, even over another tab", async () => {
    // Nothing answers until the server is started.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("refused"))),
    );
    const fake = await startThread();
    await act(async () => {
      fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Dev server command" }), { target: { value: "pnpm dev" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start dev server" }));
    });
    // The person looks at Code while the server starts.
    fireEvent.click(screen.getByRole("tab", { name: /^Code/ }));
    await fake.serverSays(1, "  ➜  Local:   http://localhost:5174/");
    expect(shown()).toBe("Preview");
  });

  it("opens Code at a file the conversation says was edited", async () => {
    const fake = await startThread({ autoPanel: false });
    await fake.emit(edit("src/Card.tsx"), edit("src/Badge.tsx"));
    await fake.exit(0);
    expect(shown()).toBeNull();
    fireEvent.click(screen.getByText("Edited Card.tsx and 1 more"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "src/Badge.tsx" }));
    });
    expect(shown()).toBe("Code");
    expect(screen.getByRole("region", { name: "src/Badge.tsx" })).toBeTruthy();
  });

  it("opens only when asked once that's switched off in Settings", async () => {
    const fake = await startThread({ autoPanel: false });
    await fake.emit(edit("src/Card.tsx"), look);
    expect(shown()).toBeNull();
  });
});
