import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

const prefs = () => JSON.parse(localStorage.getItem("shoji.prefs") ?? "{}");
const app = () => document.querySelector<HTMLElement>(".app")!;
const field = () => document.querySelector("canvas.field");

describe("the Zone look", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function settings() {
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
  }

  it("draws Code current behind frosted glass by default", async () => {
    await settings();
    expect(field()).toBeTruthy();
    const background = screen.getByRole("radiogroup", { name: "Background" });
    expect(within(background).getByRole("radio", { name: "Code current" }).getAttribute("aria-checked")).toBe("true");
    expect(app().style.getPropertyValue("--bm")).toBe("4.2px");
  });

  it("can draw nothing at all", async () => {
    await settings();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Background" })).getByRole("radio", { name: "None" }),
    );
    expect(prefs().field).toBe("none");
    expect(field()).toBeNull();
  });

  it("sets the frost of the main stage", async () => {
    await settings();
    fireEvent.change(screen.getByRole("slider", { name: /Main area frost/ }), { target: { value: "100" } });
    expect(prefs().frost).toBe(100);
    expect(app().style.getPropertyValue("--bm")).toBe("15.0px");
    expect(app().style.getPropertyValue("--tm")).toBe("0.820");
  });

  it("makes every surface solid and stops drawing when transparency is reduced", async () => {
    await settings();
    fireEvent.click(screen.getByRole("switch", { name: "Reduce transparency" }));
    expect(app().hasAttribute("data-opaque")).toBe(true);
    expect(field()).toBeNull();
    expect(screen.getByRole("slider", { name: /Main area frost/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("what the app shows", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function settings() {
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
  }

  it("takes the accent everywhere running or spending is shown", async () => {
    await settings();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Accent" })).getByRole("radio", { name: "Sodium" }));
    expect(prefs().accent).toBe("sodium");
    expect(app().style.getPropertyValue("--safe-rgb")).toBe("255,176,46");
  });

  it("can be compact, and hide the status bar and model names", async () => {
    await settings();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Density" })).getByRole("radio", { name: "Compact" }),
    );
    expect(app().getAttribute("data-density")).toBe("compact");
    fireEvent.click(screen.getByRole("switch", { name: "Status bar" }));
    expect(document.querySelector("footer.status")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Model names" }));
    expect(app().getAttribute("data-models")).toBe("hidden");
  });
});
