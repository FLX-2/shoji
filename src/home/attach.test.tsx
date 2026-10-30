import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

describe("attaching files to a task", () => {
  beforeEach(() => localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false })));
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function home() {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await act(async () => {});
    return { fake, box: screen.getByRole("textbox", { name: "Task" }) };
  }

  it("attaches picked and pasted files, lets one go, and sends the rest with the task to every run", async () => {
    const { fake, box } = await home();
    fake.picked.push("/Users/bob/Desktop/mock.png", "C:\\Users\\bob\\notes.md");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach screenshots or files" }));
    });
    const shot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { files: [shot] } });
    });
    expect(fake.calls.pasted).toEqual([{ name: "image.png", bytes: [1, 2, 3] }]);
    expect(screen.getByRole("button", { name: /^notes\.md/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^notes\.md/ }));
    expect(screen.queryByRole("button", { name: /^notes\.md/ })).toBeNull();

    fireEvent.change(box, { target: { value: "Match the mock" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[0].attachments).toEqual(["/Users/bob/Desktop/mock.png", "/data/attachments/image.png"]);
    // The task in the thread names what came with it.
    expect(document.querySelector(".umsg .attached")?.textContent).toBe("mock.pngimage.png");

    const costByRole = { scout: 0, plan: 0, build: 0, review: 0 };
    const stopped = { status: "stopped", plan: "1. Match it.", diff: "", review: "", checks: [], escalated: false, cost: 0.5 } as const;
    fake.emit({ type: "result", result: { ...stopped, costByRole } });
    fake.exit(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Keep going/ }));
    });
    expect(fake.calls.starts[1].attachments).toEqual(fake.calls.starts[0].attachments);
  });

  it("sends nothing extra when nothing is attached", async () => {
    const { fake, box } = await home();
    fireEvent.change(box, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(fake.calls.starts[0]).not.toHaveProperty("attachments");
  });
});
