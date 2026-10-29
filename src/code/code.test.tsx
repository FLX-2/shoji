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

  it("holds accept and revert while a run is editing the project", async () => {
    const fake = fakeBridge();
    fake.project.diff = DIFF;
    render(<App bridge={fake.bridge} />);
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add annual pricing" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    });
    expect(screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Revert" }).hasAttribute("disabled")).toBe(true);
  });
});
