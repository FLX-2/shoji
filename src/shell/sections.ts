export type SectionId = "home" | "threads" | "agents" | "receipts" | "stack" | "settings";

export interface Section {
  label: string;
  /** SVG path data on a 24px grid, drawn as a 1.5px stroke. */
  icon: string;
  title: string;
  body: string;
}

export const SECTIONS: Record<SectionId, Section> = {
  home: {
    label: "Home",
    icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
    title: "The right model for every step.",
    body: "Describe a change and Shoji plans it, builds it and checks it with a small team of models, each chosen for its step.",
  },
  threads: {
    label: "Threads",
    icon: "M4 6h16M4 12h10M4 18h13",
    title: "No threads yet",
    body: "Every task becomes a thread: the plan, the code it changed, and a review before anything is committed.",
  },
  agents: {
    label: "Agents",
    icon: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z",
    title: "Nothing running",
    body: "Threads that are running or need you sit here side by side, so you can follow several at once.",
  },
  receipts: {
    label: "Receipts",
    icon: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6",
    title: "No receipts yet",
    body: "Each finished thread leaves a receipt with the model behind every step and what it cost.",
  },
  stack: {
    label: "Stack",
    icon: "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
    title: "Which model takes each step",
    body: "By default Opus 5.5 plans, Sonnet 5.5 builds, and Haiku 5.5 scouts and reviews.",
  },
  settings: {
    label: "Settings",
    icon: "M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0a2 2 0 1 1 4 0M11 17a2 2 0 1 1-4 0a2 2 0 1 1 4 0",
    title: "Settings",
    body: "Models, keys, budgets and the look of Shoji will live here.",
  },
};

/** Rail order. `null` draws a separator, `"spacer"` pushes the rest to the bottom. */
export const RAIL: (SectionId | null | "spacer")[] = [
  "home",
  "threads",
  "agents",
  null,
  "receipts",
  "stack",
  "spacer",
  "settings",
];
