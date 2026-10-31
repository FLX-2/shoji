import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Darkroom or paper, or whichever the system is using. */
export type ThemeId = "dark" | "light" | "system";

export const THEME_NAMES: Record<ThemeId, string> = { dark: "Dark", light: "Light", system: "Match system" };

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemLight() {
  return typeof matchMedia === "function" && matchMedia(LIGHT_QUERY).matches;
}

/** The theme Shoji draws in now. It follows the system as the system changes when the choice is Match system. */
export function useTheme(choice: ThemeId): "dark" | "light" {
  const [light, setLight] = useState(systemLight);
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia(LIGHT_QUERY);
    const changed = () => setLight(query.matches);
    changed();
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, [choice]);
  const shown = choice === "system" ? (light ? "light" : "dark") : choice;

  useEffect(() => {
    // On the root, so the body behind the app and the terminal, which reads tokens from here, turn over too.
    document.documentElement.dataset.theme = shown;
    try {
      // The window's own parts, such as the Mac's buttons and scroll bars, follow along.
      getCurrentWindow()
        .setTheme(choice === "system" ? null : shown)
        .catch(() => {});
    } catch {
      // Outside Tauri, as in tests, there's no window.
    }
  }, [choice, shown]);

  return shown;
}
