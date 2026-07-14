import { afterEach, expect, test, vi } from "vitest";
import { randomId } from "../src";

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

// strongRandom ids must come from the CSPRNG, never Math.random() (CWE-338).
test("strongRandom does not use Math.random()", () => {
  const spy = vi.spyOn(Math, "random");
  const id = randomId({ digits: 32, strongRandom: true, prefix: "key" });
  expect(spy).not.toHaveBeenCalled();
  expect(id).toBe("key_" + id.slice(4));
  expect(id.length).toBe("key_".length + 32);
});

test("strongRandom stays random even when Math.random() is pinned", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  const id = randomId({ digits: 64, strongRandom: true });
  expect(new Set(id).size).toBeGreaterThan(1);
});
