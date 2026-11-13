const UNITS = ["KB", "MB", "GB", "TB"];

/** A size on disk as a file manager says it: 412 KB, 38 MB, 1.2 GB. */
export function formatBytes(bytes: number): string {
  let value = Math.max(bytes, 1) / 1000;
  let unit = 0;
  while (value >= 999.5 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // One decimal only where it says something: 1.2 GB, but 38 MB and 412 KB.
  const shown = unit > 0 && value < 9.95 ? value.toFixed(1) : String(Math.max(1, Math.round(value)));
  return `${shown} ${UNITS[unit]}`;
}
