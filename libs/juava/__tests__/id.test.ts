import { afterEach, expect, test, vi } from "vitest";
import { randomId } from "../src";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

afterEach(() => {
  vi.restoreAllMocks();
});

test("id test", () => {
  const id1 = randomId();
  const id2 = randomId(10);
  const id3 = randomId({ digits: 10 });
  const id4 = randomId({ digits: 10, prefix: "test" });

  console.log([id1, id2, id3, id4].join("\n"));

  expect(id1.length).toBeGreaterThan(10);
  expect(id3.length).toBe(10);
  expect(id2.length).toBe(10);
  expect(id3.length).toBe(10);
  expect(id4.length).toBe("test_".length + 10);
  expect(id4.startsWith("test_")).toBe(true);
});

test("only emits characters from the expected alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const id = randomId(32);
    for (const ch of id) {
      expect(ALPHABET).toContain(ch);
    }
  }
});

test("first character is never a digit (so ids are valid identifiers)", () => {
  for (let i = 0; i < 500; i++) {
    const id = randomId(16);
    expect(/^[0-9]/.test(id)).toBe(false);
  }
});

// --- Security regression tests (CWE-338: weak randomness for secrets) ---
//
// randomId() mints bearer credentials (API key secrets, CLI keys, invitation
// tokens). It MUST draw from a CSPRNG, never Math.random(), whose state is
// recoverable from observed output, which would let an attacker predict tokens.

test("does not use Math.random()", () => {
  const spy = vi.spyOn(Math, "random");
  randomId(32);
  randomId({ digits: 16, prefix: "key" });
  expect(spy).not.toHaveBeenCalled();
});

test("output is independent of Math.random() (stays random when it is pinned)", () => {
  // Pin Math.random to a constant. A weak implementation would now emit a
  // constant character; a CSPRNG-backed one keeps producing varied output.
  vi.spyOn(Math, "random").mockReturnValue(0);
  const id = randomId(64);
  const distinct = new Set(id.split(""));
  expect(distinct.size).toBeGreaterThan(1);
});

test("generates unique ids with no collisions across many draws", () => {
  const seen = new Set<string>();
  const n = 5000;
  for (let i = 0; i < n; i++) {
    seen.add(randomId(24));
  }
  expect(seen.size).toBe(n);
});

test("character distribution is broad (no modulo collapse / bias smoke test)", () => {
  // Concatenate many ids and confirm the generator covers most of the
  // 62-character alphabet — a buggy CSPRNG mapping (e.g. broken rejection
  // sampling) would collapse onto a narrow subset.
  let blob = "";
  for (let i = 0; i < 200; i++) {
    blob += randomId(32);
  }
  const distinct = new Set(blob.split(""));
  expect(distinct.size).toBeGreaterThanOrEqual(50);
});
