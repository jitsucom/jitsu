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

/**
 * Fills `size` bytes from a cryptographically secure source.
 *
 * `Math.random()` is deliberately NOT used here: `randomId()` mints bearer
 * credentials (API key secrets, CLI keys, workspace invitation tokens), and
 * V8's `Math.random()` is a PRNG whose internal state is recoverable from a
 * few observed outputs — letting an attacker predict subsequent tokens.
 *
 * Prefers the Web Crypto API (available in browsers and Node >= 19, and this
 * module is bundled into the browser console) and falls back to Node's
 * `crypto.randomBytes` for older/edge runtimes.
 */
function secureRandomBytes(size: number): Uint8Array {
  const webcrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    return webcrypto.getRandomValues(new Uint8Array(size));
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("crypto").randomBytes(size);
}

/**
 * Uniform integer in [0, max) using rejection sampling to avoid the modulo
 * bias that `byte % max` would introduce when `max` does not divide 256.
 */
function secureRandomInt(max: number): number {
  const limit = 256 - (256 % max); // largest multiple of `max` that is <= 256
  while (true) {
    const byte = secureRandomBytes(1)[0];
    if (byte < limit) {
      return byte % max;
    }
  }
}

function randomChar(noDigits?: boolean) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  while (true) {
    const index = secureRandomInt(chars.length);
    if (!noDigits || index > 9) {
      return chars[index];
    }
  }
}

//sanitizes string for usage in file name
export function sanitize(name: string, replacement = "-") {
  return name.replace(/[^a-zA-Z0-9]+/gi, replacement).toLowerCase();
}
