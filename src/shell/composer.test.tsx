import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./Composer";

function composer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const picked = vi.fn();
  const view = render(
    <div>
      <p>The work</p>
      <Composer label="Changes" placeholder="Describe the changes you want…" onSend={() => {}} rests {...props}>
        <button type="button" onClick={picked}>
          Ask a question
        </button>
      </Composer>
    </div>,
  );
  const form = view.container.querySelector("form")!;
  return { form, box: screen.getByRole("textbox", { name: "Changes" }), picked };
}

describe("a composer that rests", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("rests until it has the focus, and again once a press lands outside it", () => {
    const { form, box } = composer();
    expect(form.className).toBe("composer resting");
    fireEvent.focus(box);
    expect(form.className).toBe("composer");

    // A press on one of its own choices keeps it open, though on macOS the text has lost the focus by then.
    fireEvent.blur(box);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Ask a question" }));
    expect(form.className).toBe("composer");

    fireEvent.pointerDown(screen.getByText("The work"));
    expect(form.className).toBe("composer resting");
  });

  it("stays open while it holds anything written", () => {
    const { form, box } = composer();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Make the badge green" } });
    fireEvent.pointerDown(screen.getByText("The work"));
    expect(form.className).toBe("composer");
    fireEvent.change(box, { target: { value: "" } });
    expect(form.className).toBe("composer resting");
  });

  it("doesn't let the second press of a double click pick a choice that opening moved under the pointer", () => {
    vi.useFakeTimers();
    const { box, picked } = composer();
    const choice = screen.getByRole("button", { name: "Ask a question" });
    fireEvent.focus(box);
    fireEvent.click(choice, { detail: 2 });
    expect(picked).not.toHaveBeenCalled();

    // A moment later the press is the person's own choice, and so is one made from the keyboard at any time.
    vi.advanceTimersByTime(600);
    fireEvent.click(choice, { detail: 1 });
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it("picks a choice from the keyboard straight after opening", () => {
    const { box, picked } = composer();
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }), { detail: 0 });
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it("never rests unless it is asked to", () => {
    const { form } = composer({ rests: false });
    expect(form.className).toBe("composer");
  });
});
