import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

afterEach(cleanup);

describe("app shell", () => {
  it("opens on Home with the rail's five sections", () => {
    render(<App />);
    const rail = screen.getByRole("navigation", { name: "App sections" });
    const labels = Array.from(rail.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Home", "Threads", "Receipts", "Stack", "Settings"]);
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("The right model for every step.")).toBeTruthy();
  });

  it("switches section from the rail", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Receipts" }));
    expect(screen.getByRole("button", { name: "Receipts" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Receipts" })).toBeTruthy();
  });

  it("starts idle, so nothing is lit red", () => {
    render(<App />);
    expect(document.querySelector(".app")?.getAttribute("data-state")).toBe("idle");
    expect(screen.getByRole("status").textContent).toBe("idle");
  });
});
