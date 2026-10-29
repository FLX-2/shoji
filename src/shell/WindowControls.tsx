import { getCurrentWindow } from "@tauri-apps/api/window";

const CONTROLS = [
  { label: "Minimize", path: "M5 12h14", act: () => getCurrentWindow().minimize() },
  { label: "Maximize", path: "M6 6h12v12H6z", act: () => getCurrentWindow().toggleMaximize() },
  { label: "Close", path: "M6 6l12 12M18 6L6 18", act: () => getCurrentWindow().close() },
];

/** Window buttons for Windows and Linux, where Shoji draws its own title bar.
 *  macOS keeps its own traffic lights. */
export function WindowControls() {
  return (
    <div className="winctl">
      {CONTROLS.map((c) => (
        <button key={c.label} type="button" aria-label={c.label} title={c.label} onClick={c.act}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={c.path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
