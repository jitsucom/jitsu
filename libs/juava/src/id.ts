export type RandomOpts = {
  digits?: number;
  prefix?: string;
  // Draw from a CSPRNG instead of Math.random(). Set it for bearer credentials
  // (API key secrets, CLI keys, invitation tokens): Math.random()'s internal
  // state is recoverable from its output, so plain ids are predictable (CWE-338).
  strongRandom?: boolean;
};

/**
 * Compatibility wrapper for old args
 */
export type RandomOptsCompat = RandomOpts | number;

const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomId(_opts: RandomOptsCompat = {}): string {
  const opts: RandomOpts = typeof _opts === "number" ? { digits: _opts } : _opts;
  const digits = opts.digits ?? 24;
  const prefix = opts.prefix ?? "";
  const randomInt = opts.strongRandom ? secureRandomInt : insecureRandomInt;
  let id = "";
  for (let i = 0; i < digits; i++) {
    id += randomChar(randomInt, i === 0);
  }
  return `${prefix ? prefix + "_" : ""}${id}`;
}

function randomChar(randomInt: (max: number) => number, noDigits?: boolean) {
  while (true) {
    const index = randomInt(chars.length);
    if (!noDigits || index > 9) {
      return chars[index];
    }
  }
}

function insecureRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

// Uniform int in [0, max) from the platform CSPRNG (Web Crypto — present in
// browsers, Node >= 19, and edge runtimes). Rejection sampling avoids the modulo
// bias of `byte % max` when max does not divide 256.
function secureRandomInt(max: number): number {
  const limit = 256 - (256 % max);
  const buf = new Uint8Array(1);
  while (true) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return buf[0] % max;
    }
  }
}

//sanitizes string for usage in file name
export function sanitize(name: string, replacement = "-") {
  return name.replace(/[^a-zA-Z0-9]+/gi, replacement).toLowerCase();
}
