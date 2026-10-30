import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const DIFF = `diff --git a/src/Card.tsx b/src/Card.tsx
index 1111111..2222222 100644
--- a/src/Card.tsx
+++ b/src/Card.tsx
@@ -1,2 +1,2 @@
-export const price = plan.monthly;
+export const price = plan.annual / 12;
 export default price;
diff --git a/src/Badge.tsx b/src/Badge.tsx
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/Badge.tsx
@@ -0,0 +1 @@
+export const Badge = () => "Save 20%";
`;

describe("the thread's Code", () => {
  beforeEach(() => localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page" })));
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function finishedThread() {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add annual pricing" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    fake.project.diff = DIFF;
    await act(async () => fake.exit(0));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    });
    return fake;
  }

  it("lists the changed files with their diff", async () => {
    await finishedThread();
    expect(screen.getByRole("button", { name: /^Code/ }).textContent).toBe("Code2 files");
    const list = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Card.tsxsrc+1 −1",
      "Badge.tsxsrc+1 −0",
    ]);
    const pane = screen.getByRole("region", { name: "src/Card.tsx" });
    expect(pane.querySelector(".l.del .tx")?.textContent).toBe("export const price = plan.monthly;");
    expect(pane.querySelector(".l.add .tx")?.textContent).toBe("export const price = plan.annual / 12;");
  });

  it("moves between files with the arrow keys", async () => {
    await finishedThread();
    const list = screen.getByRole("navigation", { name: "Changed files" });
    const [card, badge] = within(list).getAllByRole("button");
    card.focus();
    expect(fireEvent.keyDown(card, { key: "ArrowDown" })).toBe(false);
    expect(screen.getByRole("region", { name: "src/Badge.tsx" })).toBeTruthy();
    expect(badge.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(badge);

    fireEvent.keyDown(badge, { key: "ArrowDown" });
    expect(screen.getByRole("region", { name: "src/Badge.tsx" })).toBeTruthy();

    fireEvent.keyDown(badge, { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "src/Card.tsx" })).toBeTruthy();
    expect(card.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(card);

    fireEvent.keyDown(card, { key: "ArrowUp" });
    expect(screen.getByRole("region", { name: "src/Card.tsx" })).toBeTruthy();
  });

  it("keeps the chosen file when switching to Conversation and back", async () => {
    await finishedThread();
    const list = screen.getByRole("navigation", { name: "Changed files" });
    fireEvent.click(within(list).getByRole("button", { name: /Badge\.tsx/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    });
    expect(screen.getByRole("region", { name: "src/Badge.tsx" })).toBeTruthy();
    const again = screen.getByRole("navigation", { name: "Changed files" });
    expect(within(again).getByRole("button", { name: /Badge\.tsx/ }).getAttribute("aria-current")).toBe("true");
  });

  it("switches views with Ctrl+1 and Ctrl+2", async () => {
    await finishedThread();
    await act(async () => {
      fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    });
    expect(screen.queryByRole("navigation", { name: "Changed files" })).toBeNull();
    expect(screen.getByRole("button", { name: "Conversation" }).getAttribute("aria-current")).toBe("page");
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    });
    expect(screen.getByRole("navigation", { name: "Changed files" })).toBeTruthy();
  });

  it("accepts a file, and reverts one only after asking", async () => {
    const fake = await finishedThread();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    });
    expect(fake.calls.accepted).toEqual(["src/Card.tsx"]);
    expect(screen.getByText("Accepted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Badge\.tsx/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(fake.calls.reverted).toEqual([]);
    expect(screen.getByText("Delete this new file?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    expect(fake.calls.reverted).toEqual(["src/Badge.tsx"]);
  });

  it("edits a changed file by hand and saves it with Ctrl+S", async () => {
    const fake = await finishedThread();
    fake.project.contents["src/Card.tsx"] = "export const price = plan.annual / 12;\nexport default price;\n";
    const pane = screen.getByRole("region", { name: "src/Card.tsx" });
    await act(async () => {
      fireEvent.click(within(pane).getByRole("button", { name: "Edit" }));
    });
    const editor = within(pane).getByRole("textbox", { name: "Edit src/Card.tsx" }) as HTMLTextAreaElement;
    expect(editor.value).toBe("export const price = plan.annual / 12;\nexport default price;\n");
    fireEvent.change(editor, { target: { value: "export const price = Math.round(plan.annual / 12);\n" } });
    await act(async () => {
      fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    });
    expect(fake.calls.writes).toEqual([
      { path: "src/Card.tsx", contents: "export const price = Math.round(plan.annual / 12);\n" },
    ]);
    // Back to the diff, read again with the edit in it.
    expect(within(pane).queryByRole("textbox")).toBeNull();

    // Escape leaves without saving.
    await act(async () => {
      fireEvent.click(within(pane).getByRole("button", { name: "Edit" }));
    });
    fireEvent.keyDown(within(pane).getByRole("textbox"), { key: "Escape" });
    expect(within(pane).queryByRole("textbox")).toBeNull();
    expect(fake.calls.writes).toHaveLength(1);
  });

  it("holds accept and revert while a run is editing the project", async () => {
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add annual pricing" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    // The run has started editing.
    fake.project.diff = DIFF;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    });
    expect(screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Revert" }).hasAttribute("disabled")).toBe(true);
  });
});
