/** The accent marks one thing: something is running or spending. Safelight is the Zone red. */
export const ACCENTS = {
  safelight: { name: "Safelight", rgb: [255, 91, 58] },
  sodium: { name: "Sodium", rgb: [255, 176, 46] },
  mono: { name: "Mono", rgb: [248, 246, 242] },
} as const;

export type AccentId = keyof typeof ACCENTS;
