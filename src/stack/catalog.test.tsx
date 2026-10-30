import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { applyCatalog, MODELS } from "../../runtime/src/models";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { CATALOG_URL } from "./catalog";

const LIST = {
  version: 1,
  updated: "2026-12-01",
  models: {
    "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 1.5, output: 7.5, cacheRead: 0.15 },
    "claude-sonnet-6": { label: "Sonnet 6", input: 3, output: 15, cacheRead: 0.3 },
  },
};

describe("keeping models current", () => {
  let served: unknown = LIST;
  let requests: [string, RequestInit | undefined][] = [];
  beforeEach(() => {
    served = LIST;
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push([url, init]);
        return new Response(JSON.stringify(served));
      }),
    );
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    applyCatalog(null);
  });

  async function launch() {
    const fake = fakeBridge();
    await act(async () => {
      render(<App bridge={fake.bridge} />);
    });
    return fake;
  }

  async function open(section: string) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: section }));
    });
  }

  it("downloads the list once a day, asking nothing of the person, and hands it to every run", async () => {
    const fake = await launch();
    expect(requests).toEqual([
      [CATALOG_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }],
    ]);
    await open("Stack");
    expect(screen.getByRole("cell", { name: "Sonnet 6" })).toBeTruthy();
    expect(screen.getByText("Dollars per million tokens, as Anthropic listed them on 1 Dec 2026.")).toBeTruthy();

    await open("Home");
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].models).toEqual(LIST);
    cleanup();

    // A day hasn't passed, so the saved list is used without asking again.
    applyCatalog(null);
    await launch();
    expect(requests).toHaveLength(1);
    expect(MODELS["claude-sonnet-6"]).toBeTruthy();
  });

  it("keeps the built-in list when the download is broken, and downloads nothing when turned off", async () => {
    served = { ...LIST, models: { "claude-sonnet-6": { label: "Sonnet 6", input: 0, output: 0, cacheRead: 0 } } };
    const fake = await launch();
    expect(MODELS["claude-sonnet-6"]).toBeUndefined();
    await open("Settings");
    expect(
      screen.getByText(/It sends nothing about you or your work\. Prices as listed on 28 Oct 2026\./),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Keep models current" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).updateModels).toBe(false);
    expect(fake.calls.starts).toEqual([]);
    cleanup();

    requests = [];
    await launch();
    expect(requests).toEqual([]);
  });
});
