/** The locale dates and times are written in: the system's own. Tests pin one, so they read the same anywhere. */
export const locale = (): string | undefined => (globalThis as { shojiLocale?: string }).shojiLocale;
