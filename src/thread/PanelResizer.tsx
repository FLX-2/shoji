import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";

const KEY = "shoji.panelWidth";
/** The narrowest the side panel goes, and the least room the conversation keeps beside it. */
export const MIN_PANEL = 320;
export const MIN_CONVERSATION = 360;
const STEP = 24;

/** A width the side panel can take in a thread this wide. */
export function clampPanel(width: number, total: number): number {
  return Math.round(Math.max(MIN_PANEL, Math.min(width, total - MIN_CONVERSATION)));
}

function saved(): number | null {
  try {
    const width = Number(localStorage.getItem(KEY));
    return Number.isFinite(width) && width >= MIN_PANEL ? width : null;
  } catch {
    return null;
  }
}

/** The side panel's width as the person dragged it, kept for next time; null is the panel's own share. */
export function usePanelWidth(): [number | null, (width: number | null) => void] {
  const [width, setWidth] = useState<number | null>(saved);
  const set = useCallback((next: number | null) => {
    setWidth(next);
    try {
      if (next === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(next));
    } catch {
      // Kept for this session only.
    }
  }, []);
  return [width, set];
}

/** The columns for a thread with its panel open at this width, giving way when the window is narrower. */
export const panelColumns = (width: number) =>
  `minmax(${MIN_CONVERSATION}px, 1fr) min(${width}px, calc(100% - ${MIN_CONVERSATION}px))`;

/**
 * The side panel's left edge, which drags to make the panel wider or narrower. Arrow keys move it too, and a
 * double click gives the panel its own share again.
 */
export function PanelResizer({ width, onWidth }: { width: number | null; onWidth: (width: number | null) => void }) {
  const thread = (target: Element) => target.closest(".thread")!.getBoundingClientRect();
  const panel = (target: Element) => target.closest(".tpane")!.getBoundingClientRect().width;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (m: globalThis.PointerEvent) => {
      const box = thread(handle);
      onWidth(clampPanel(box.right - m.clientX, box.width));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0;
    if (!by) return;
    e.preventDefault();
    onWidth(clampPanel((width ?? panel(e.currentTarget)) + by, thread(e.currentTarget).width));
  };

  return (
    <div
      className="presize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel"
      title="Drag to resize. Double-click to reset."
      tabIndex={0}
      {...(width !== null && { "aria-valuenow": width })}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}
