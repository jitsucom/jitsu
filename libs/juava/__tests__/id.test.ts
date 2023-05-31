import { checkHash, createHash, randomId } from "../src";

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
