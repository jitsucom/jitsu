/** Compact elapsed time; tolerate small clock differences between client and server. */
export function shortTimeAgo(date: Date, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 5) return "just now";
  for (const [size, unit] of [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
    [1, "s"],
  ] as const) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return "—";
}
