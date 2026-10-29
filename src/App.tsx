import { useState } from "react";
import { Mark } from "./shell/Mark";
import { Rail } from "./shell/Rail";
import { SECTIONS, type SectionId } from "./shell/sections";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

function App() {
  const [section, setSection] = useState<SectionId>("home");
  const current = SECTIONS[section];

  return (
    <div className="app" data-state="idle" data-platform={isMac ? "mac" : "other"}>
      <header className="titlebar solid" data-tauri-drag-region>
        <div data-tauri-drag-region />
        <div className="center" data-tauri-drag-region>
          <span className="lockup" data-tauri-drag-region>
            <Mark />
            shoji
          </span>
        </div>
        <div className="right" data-tauri-drag-region>
          <span className="runlight" role="status">
            <span className="dot live" aria-hidden="true" />
            idle
          </span>
        </div>
      </header>

      <div className="body">
        <Rail current={section} onSelect={setSection} />
        <main className="main">
          {section !== "home" && (
            <div className="mh">
              <h1>{current.label}</h1>
            </div>
          )}
          <div className="empty">
            {section === "home" && <Mark large />}
            <h2>{current.title}</h2>
            <p>{current.body}</p>
          </div>
        </main>
      </div>

      <footer className="status solid">
        <span>No project open</span>
      </footer>
    </div>
  );
}

export default App;
