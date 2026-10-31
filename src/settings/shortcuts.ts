/** Every keyboard shortcut in Shoji, as Settings lists them. `mod` is Ctrl, or ⌘ on a Mac. */
export const SHORTCUTS: { group: string; keys: string[]; what: string }[] = [
  { group: "Anywhere", keys: ["mod", "K"], what: "Search threads, projects, views and settings" },
  { group: "Writing a task", keys: ["Enter"], what: "Send it" },
  { group: "Writing a task", keys: ["Shift", "Enter"], what: "Start a new line" },
  { group: "Writing a task", keys: ["@"], what: "Mention a file of the project" },
  { group: "Writing a task", keys: ["/"], what: "Start with one of the project's commands" },
  { group: "Writing a task", keys: ["Tab"], what: "Take the file or command picked in the list" },
  { group: "In a thread", keys: ["mod", "1"], what: "Close the side panel" },
  { group: "In a thread", keys: ["mod", "2"], what: "Code, in the side panel" },
  { group: "In a thread", keys: ["mod", "3"], what: "Preview, in the side panel" },
  { group: "In a thread", keys: ["mod", "4"], what: "Terminal, in the side panel" },
  { group: "In Code", keys: ["↑", "↓"], what: "The previous or next changed file" },
  { group: "In Code", keys: ["mod", "S"], what: "Save the file you're editing" },
  { group: "Everywhere", keys: ["Esc"], what: "Close the box, list or editor that's open" },
];

/** A key as this computer's keyboard labels it. */
export const keyLabel = (key: string, mac: boolean) => (key === "mod" ? (mac ? "⌘" : "Ctrl") : key);
