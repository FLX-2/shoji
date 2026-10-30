import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";
import { isLocal } from "./PreviewView";

describe("the preview's address", () => {
  it("is this computer's dev server only", () => {
    expect(isLocal("http://localhost:5173")).toBe(true);
    expect(isLocal("http://127.0.0.1:3000/pricing")).toBe(true);
    expect(isLocal("https://example.com")).toBe(false);
    expect(isLocal("localhost:5173")).toBe(false);
    expect(isLocal("file:///etc/passwd")).toBe(false);
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

  async function openPreview() {
    render(<App bridge={fakeBridge().bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
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
});
