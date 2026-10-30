import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// Drawn like Windows 11's own buttons: 10px glyphs on a 1px line, in a 46px-wide cell the full
// height of the title bar.
const GLYPHS = {
  minimize: "M0 5.5h10",
  maximize: "M1.5 0.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z",
  restore:
    "M1.5 2.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM2.5 0.5h5.5a1.5 1.5 0 0 1 1.5 1.5v5.5",
  close: "M0.5 0.5l9 9M9.5 0.5l-9 9",
};

/** Window buttons for Windows and Linux, where Shoji draws its own title bar.
 *  macOS keeps its own traffic lights. */
export function WindowControls() {
  const maximized = useMaximized();
  const controls = [
    { label: "Minimize", glyph: GLYPHS.minimize, act: () => getCurrentWindow().minimize() },
    {
      label: maximized ? "Restore" : "Maximize",
      glyph: maximized ? GLYPHS.restore : GLYPHS.maximize,
      act: () => getCurrentWindow().toggleMaximize(),
    },
    { label: "Close", glyph: GLYPHS.close, act: () => getCurrentWindow().close() },
  ];
  return (
    <div className="winctl">
      {controls.map((c) => (
        <button
          key={c.label}
          type="button"
          aria-label={c.label}
          title={c.label}
          className={c.label === "Close" ? "close" : undefined}
          onClick={c.act}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d={c.glyph} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** Whether the window fills the screen, so the middle button can offer to restore it. */
function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let window: ReturnType<typeof getCurrentWindow>;
    try {
      window = getCurrentWindow();
    } catch {
      return; // Outside Tauri, as in tests, there's no window to ask.
    }
    const read = () =>
      window
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
    read();
    const unlisten = window.onResized(read).catch(() => () => {});
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);
  return maximized;
}
