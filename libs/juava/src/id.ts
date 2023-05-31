export type RandomOpts = { digits?: number; prefix?: string };

/**
 * Compatibility wrapper for old args
 */
export type RandomOptsCompat = RandomOpts | number;

export function randomId(_opts: RandomOptsCompat = {}): string {
  const opts: RandomOpts = typeof _opts === "number" ? { digits: _opts } : _opts;
  const digits = opts.digits ?? 24;
  const prefix = opts.prefix ?? "";
  let id = "";
  for (let i = 0; i < digits; i++) {
    id += randomChar(i === 0);
  }
  return `${prefix ? prefix + "_" : ""}${id}`;
}

function randomChar(noDigits?: boolean) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  while (true) {
    const index = Math.floor(Math.random() * chars.length);
    if (!noDigits || index > 9) {
      return chars[index];
    }
  }
}
