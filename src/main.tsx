import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/views.css";
import App from "./App";
import { BrokenWindow, Crash } from "./shell/Crash";

// The webview's own right-click menu (Back, Reload, Print) isn't Shoji's. It stays where it helps: in text boxes
// and over selected text, for Cut, Copy and Paste. Shoji's own menus open where they're offered.
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (e.defaultPrevented || target?.closest("input, textarea, [contenteditable='true'], .cm-editor, .xterm")) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Crash fallback={(problem, again) => <BrokenWindow problem={problem} version={__APP_VERSION__} onAgain={again} />}>
      <App />
    </Crash>
  </React.StrictMode>,
);
