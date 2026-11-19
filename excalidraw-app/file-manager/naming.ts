/** Name helpers for drawings. Kept pure so they're easy to test. */

const pad = (n: number) => String(n).padStart(2, "0");

/** e.g. "Drawing 2026-11-19 15.20" (no colons: not allowed in file names). */
export const defaultDrawingName = (now: Date = new Date()): string =>
  `Drawing ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}.${pad(now.getMinutes())}`;

/** Returns `base`, or `base (2)`, `base (3)`… whichever isn't taken. */
export const uniqueName = (base: string, taken: readonly string[]): string => {
  const used = new Set(taken);
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base} (${n})`)) {
    n++;
  }
  return `${base} (${n})`;
};

/** Short "5 min ago" style label for the file list. */
export const relativeTime = (iso: string, now: Date = new Date()): string => {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days} d ago`;
  }
  return new Date(iso).toLocaleDateString();
};
