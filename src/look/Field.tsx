import { useEffect, useRef } from "react";
import { drawField, type FieldId, type FieldState } from "./fields";

interface FieldProps {
  id: FieldId;
  running: boolean;
  /** Draws one still frame instead of moving, when interface motion is off. */
  still: boolean;
}

/** The background behind the glass. It draws at most 30 times a second, and not at all while the window is hidden. */
export function Field({ id, running, still }: FieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ running, still });
  live.current = { running, still };

  useEffect(() => {
    const el = canvas.current;
    const c = el?.getContext("2d");
    if (!el || !c) return;
    const state: FieldState = {};
    let w = 1;
    let h = 1;
    let t = 6;
    let last = 0;
    let frame = 0;

    const accent = () => {
      const rgb = getComputedStyle(el).getPropertyValue("--safe-rgb").split(",").map(Number);
      return (rgb.length === 3 ? rgb : [255, 91, 58]) as [number, number, number];
    };
    const draw = (moving: boolean) =>
      drawField(id, c, w, h, { t, running: live.current.running, accent: accent(), live: moving }, state);
    const size = () => {
      const box = el.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      w = Math.max(1, box.width);
      h = Math.max(1, box.height);
      el.width = Math.round(w * ratio);
      el.height = Math.round(h * ratio);
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      state.glyphs = undefined;
      draw(false);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033;
      last = now;
      if (live.current.still || document.hidden || id === "none") return;
      t += dt * (live.current.running ? 1.5 : 0.55);
      draw(true);
    };

    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [id]);

  return <canvas ref={canvas} className="field" aria-hidden="true" />;
}
