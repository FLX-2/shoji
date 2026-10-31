/** Every keyboard shortcut in Shoji, as Settings lists them. `mod` is Ctrl, or ⌘ on a Mac. */
export const SHORTCUTS: { group: string; keys: string[]; what: string }[] = [
  { group: "Anywhere", keys: ["mod", "K"], what: "Search, or run an action" },
  { group: "Anywhere", keys: ["mod", "N"], what: "New task" },
  { group: "Anywhere", keys: ["mod", ","], what: "Settings" },
  { group: "Anywhere", keys: ["mod", "/"], what: "These shortcuts" },
  { group: "Anywhere", keys: ["mod", "+"], what: "Larger text" },
  { group: "Anywhere", keys: ["mod", "-"], what: "Smaller text" },
  { group: "Anywhere", keys: ["mod", "0"], what: "Text at its usual size" },
  { group: "Anywhere", keys: ["Ctrl", "Tab"], what: "The next thread in the list, or with Shift the one before" },
  { group: "Anywhere", keys: ["mod", "Shift", "A"], what: "The next thread that needs you" },
  { group: "Writing a task", keys: ["Enter"], what: "Send it" },
  { group: "Writing a task", keys: ["Shift", "Enter"], what: "Start a new line" },
  { group: "Writing a task", keys: ["@"], what: "Mention a file of the project" },
  { group: "Writing a task", keys: ["/"], what: "Start with one of the project's commands" },
  { group: "Writing a task", keys: ["Tab"], what: "Take the file or command picked in the list" },
  { group: "Writing a task", keys: ["↑"], what: "In an empty box, bring back what you last sent there" },
  { group: "In Threads", keys: ["mod", "B"], what: "Hide or show the thread list" },
  { group: "In Threads", keys: ["F2"], what: "Rename the thread picked in the list" },
  { group: "In Threads", keys: ["↑", "↓"], what: "Move through the thread list" },
  { group: "In a thread", keys: ["Esc"], what: "Stop the run, when the box is empty" },
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
