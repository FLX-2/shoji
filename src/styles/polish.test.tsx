import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import type { LedgerThread } from "../bridge";
import { fakeBridge } from "../test/fakeBridge";
import { when } from "../thread/ThreadList";

const HAIKU = "claude-haiku-5-5";
const styles = join(__dirname);
const tokens = readFileSync(join(styles, "tokens.css"), "utf8");
const token = (name: string) => tokens.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const record = (more: Partial<LedgerThread> = {}): LedgerThread => ({
  id: 1,
  task: "Add a FAQ",
  repo: "/work/pricing-page",
  branch: "shoji/add-a-faq",
  workdir: "/data/worktrees/add-a-faq",
  stack: "balanced",
  startedAt: Date.now(),
  committed: null,
  committedAt: null,
  runs: [{ id: 10, kind: "task", startedAt: Date.now(), status: "needs-work", calls: [] }],
  ...more,
});

describe("Zone's tokens", () => {
  it("keep small quiet text at 4.5:1 on the panes", () => {
    expect(contrast(token("z6"), token("z1"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("z6"), token("z2"))).toBeGreaterThanOrEqual(4.5);
  });

  it("are the only font sizes the styles use", () => {
    for (const file of readdirSync(styles).filter((f) => f.endsWith(".css") && f !== "tokens.css")) {
      expect(readFileSync(join(styles, file), "utf8")).not.toMatch(/font-size: [0-9.]+px/);
    }
  });
});

describe("dates", () => {
  it("say the time today, the weekday this week, and the date before", () => {
    const now = new Date(2026, 9, 31, 18, 0);
    expect(when(new Date(2026, 9, 31, 9, 5).getTime(), now)).toBe("09:05");
    expect(when(new Date(2026, 9, 27, 9, 5).getTime(), now)).toBe("Tue");
    expect(when(new Date(2026, 9, 2, 9, 5).getTime(), now)).toBe("2 Oct");
  });
});

describe("a thread's small helps", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function launch(threads: LedgerThread[] = [], before: (fake: ReturnType<typeof fakeBridge>) => void = () => {}) {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    fake.ledger.push(...threads);
    before(fake);
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    return fake;
  }

  it("shows a past thread by its title at once while its runs are read back", async () => {
    let finish: () => void = () => {};
    await launch([record()], (fake) => {
      fake.bridge.runEvents = () => new Promise((done) => (finish = () => done([])));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Threads" })).getByRole("button", { name: /^Add a FAQ/ }));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Add a FAQ");
    expect(screen.getByLabelText("Reading the thread back")).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByLabelText("Reading the thread back")).toBeNull();
  });

  it("copies the commit id and branch, and says Copied", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    await launch([record({ committed: "abc1234", committedAt: Date.now() })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Threads" })).getByRole("button", { name: /^Add a FAQ/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy the commit id" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the branch name" }));
    });
    expect(copied).toEqual(["abc1234", "shoji/add-a-faq"]);
    expect(screen.getAllByRole("button", { name: "Copied" })).toHaveLength(2);
  });

  it("offers Latest while a run works and the person scrolled up", async () => {
    const fake = await launch();
    const box = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(box, { target: { value: "Add a FAQ" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await act(async () => {
      fake.emit({ type: "step", step: "scout", role: "scout", model: HAIKU, status: "running" });
    });
    const scroll = document.querySelector(".thread .scroll") as HTMLDivElement;
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scroll.scrollTop = 200;
    await act(async () => {
      fireEvent.scroll(scroll);
    });
    scroll.scrollTo = vi.fn();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    });
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
    expect(screen.queryByRole("button", { name: "Latest" })).toBeNull();
  });
});
