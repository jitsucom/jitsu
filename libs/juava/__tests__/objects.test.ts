import { deepMerge } from "../src/objects";

describe("deepMerge", () => {
  describe("primitive source values", () => {
    test("returns source when source is null", () => {
      expect(deepMerge({ a: 1 }, null)).toBe(null);
    });

    test("returns source when source is undefined", () => {
      expect(deepMerge({ a: 1 }, undefined)).toBe(undefined);
    });

    test("returns source when source is a string", () => {
      expect(deepMerge({ a: 1 }, "hello")).toBe("hello");
    });

    test("returns source when source is a number", () => {
      expect(deepMerge({ a: 1 }, 42)).toBe(42);
    });

    test("returns source when source is a boolean", () => {
      expect(deepMerge({ a: 1 }, true)).toBe(true);
      expect(deepMerge({ a: 1 }, false)).toBe(false);
    });
  });

  describe("primitive target values", () => {
    test("returns source when target is null", () => {
      const source = { a: 1 };
      expect(deepMerge(null, source)).toBe(source);
    });

    test("returns source when target is undefined", () => {
      const source = { a: 1 };
      expect(deepMerge(undefined, source)).toBe(source);
    });

    test("returns source when target is a string", () => {
      const source = { a: 1 };
      expect(deepMerge("hello", source)).toBe(source);
    });

    test("returns source when target is a number", () => {
      const source = { a: 1 };
      expect(deepMerge(42, source)).toBe(source);
    });

    test("returns source when target is a boolean", () => {
      const source = { a: 1 };
      expect(deepMerge(true, source)).toBe(source);
      expect(deepMerge(false, source)).toBe(source);
    });
  });

  describe("array handling (arrays are replaced, not merged)", () => {
    test("returns source array when source is an array", () => {
      const source = [1, 2, 3];
      expect(deepMerge({ a: 1 }, source)).toBe(source);
    });

    test("returns source when target is an array", () => {
      const source = { a: 1 };
      expect(deepMerge([1, 2, 3], source)).toBe(source);
    });

    test("replaces target array property with source array", () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };
      const result = deepMerge(target, source);
      expect(result.items).toEqual([4, 5]);
      expect(result.items).toBe(source.items);
    });

    test("replaces nested array in deep object", () => {
      const target = { a: { b: { items: [1, 2, 3] } } };
      const source = { a: { b: { items: [4, 5, 6, 7] } } };
      const result = deepMerge(target, source);
      expect(result.a.b.items).toEqual([4, 5, 6, 7]);
    });

    test("replaces object with array", () => {
      const target = { a: { nested: "value" } };
      const source = { a: [1, 2, 3] };
      const result = deepMerge(target, source);
      expect(result.a).toEqual([1, 2, 3]);
    });

    test("replaces array with object", () => {
      const target = { a: [1, 2, 3] };
      const source = { a: { nested: "value" } };
      const result = deepMerge(target, source);
      expect(result.a).toEqual({ nested: "value" });
    });
  });

  describe("shallow object merging", () => {
    test("merges two flat objects", () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    test("source properties override target properties", () => {
      const target = { a: "original" };
      const source = { a: "updated" };
      const result = deepMerge(target, source);
      expect(result.a).toBe("updated");
    });

    test("preserves target properties not in source", () => {
      const target = { a: 1, b: 2 };
      const source = { c: 3 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe("deep object merging", () => {
    test("merges nested objects", () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { c: 3, d: 4 } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
    });

    test("merges deeply nested objects", () => {
      const target = { a: { b: { c: { d: 1, e: 2 } } } };
      const source = { a: { b: { c: { e: 3, f: 4 } } } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: { c: { d: 1, e: 3, f: 4 } } } });
    });

    test("creates nested structure if target property is undefined", () => {
      const target = { a: 1 };
      const source = { b: { c: { d: 2 } } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: { c: { d: 2 } } });
    });

    test("replaces primitive with nested object", () => {
      const target = { a: 1 };
      const source = { a: { nested: "value" } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { nested: "value" } });
    });

    test("replaces nested object with primitive", () => {
      const target = { a: { nested: "value" } };
      const source = { a: 1 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("null and undefined in nested properties", () => {
    test("source null replaces target value", () => {
      const target = { a: { b: 1 } };
      const source = { a: null };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: null });
    });

    test("source undefined replaces target value", () => {
      const target = { a: { b: 1 } };
      const source = { a: undefined };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: undefined });
    });

    test("handles null in nested source object", () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { b: null } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: null, c: 2 } });
    });

    test("handles undefined in nested source object", () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { b: undefined } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: undefined, c: 2 } });
    });

    test("handles target with null nested property", () => {
      const target = { a: null };
      const source = { a: { b: 1 } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: 1 } });
    });

    test("handles target with undefined nested property", () => {
      const target = { a: undefined };
      const source = { a: { b: 1 } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: 1 } });
    });
  });

  describe("mutation behavior", () => {
    test("mutates the target object", () => {
      const target = { a: 1 };
      const source = { b: 2 };
      const result = deepMerge(target, source);
      expect(result).toBe(target);
      expect(target).toEqual({ a: 1, b: 2 });
    });

    test("mutates nested target objects", () => {
      const nested = { b: 1 };
      const target = { a: nested };
      const source = { a: { c: 2 } };
      deepMerge(target, source);
      expect(nested).toEqual({ b: 1, c: 2 });
    });

    test("does not mutate source object", () => {
      const target = { a: 1 };
      const source = { b: 2 };
      const sourceCopy = { ...source };
      deepMerge(target, source);
      expect(source).toEqual(sourceCopy);
    });
  });

  describe("empty objects", () => {
    test("merging with empty source returns target unchanged", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, {});
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test("merging empty target with source returns populated target", () => {
      const target = {};
      const source = { a: 1, b: 2 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    test("merging two empty objects returns empty object", () => {
      const result = deepMerge({}, {});
      expect(result).toEqual({});
    });

    test("handles empty nested objects", () => {
      const target = { a: {} };
      const source = { a: { b: 1 } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: 1 } });
    });
  });

  describe("special object types", () => {
    test("Date objects are replaced, not merged", () => {
      const targetDate = new Date("2020-01-01");
      const sourceDate = new Date("2023-01-01");
      const target = { date: targetDate };
      const source = { date: sourceDate };
      const result = deepMerge(target, source);
      expect(result.date).toBe(sourceDate);
      expect(result.date.getFullYear()).toBe(2023);
    });

    test("returns source Date when source is a Date", () => {
      const date = new Date("2023-01-01");
      expect(deepMerge({ a: 1 }, date)).toBe(date);
    });

    test("returns source when target is a Date", () => {
      const source = { a: 1 };
      expect(deepMerge(new Date("2023-01-01"), source)).toBe(source);
    });

    test("replaces nested object with Date", () => {
      const target = { a: { b: 1 } };
      const date = new Date("2023-01-01");
      const source = { a: date };
      const result = deepMerge(target, source);
      expect(result.a).toBe(date);
    });

    test("replaces nested Date with object", () => {
      const target = { a: new Date("2020-01-01") };
      const source = { a: { b: 1 } };
      const result = deepMerge(target, source);
      expect(result.a).toEqual({ b: 1 });
    });

    test("handles objects with numeric keys", () => {
      const target = { 1: "a", 2: "b" };
      const source = { 2: "c", 3: "d" };
      const result = deepMerge(target, source);
      expect(result).toEqual({ 1: "a", 2: "c", 3: "d" });
    });
  });

  describe("complex real-world scenarios", () => {
    test("merges configuration objects", () => {
      const defaultConfig = {
        server: {
          host: "localhost",
          port: 3000,
          ssl: false,
        },
        database: {
          host: "localhost",
          port: 5432,
          name: "app",
        },
        features: ["feature1", "feature2"],
      };

      const userConfig = {
        server: {
          port: 8080,
          ssl: true,
        },
        features: ["feature3"],
      };

      const result = deepMerge(defaultConfig, userConfig);
      expect(result).toEqual({
        server: {
          host: "localhost",
          port: 8080,
          ssl: true,
        },
        database: {
          host: "localhost",
          port: 5432,
          name: "app",
        },
        features: ["feature3"], // Array replaced, not merged
      });
    });

    test("handles mixed nested structures", () => {
      const target = {
        user: {
          name: "John",
          settings: {
            theme: "dark",
            notifications: {
              email: true,
              sms: false,
            },
          },
          roles: ["user"],
        },
      };

      const source = {
        user: {
          settings: {
            notifications: {
              sms: true,
              push: true,
            },
          },
          roles: ["user", "admin"],
        },
      };

      const result = deepMerge(target, source);
      expect(result).toEqual({
        user: {
          name: "John",
          settings: {
            theme: "dark",
            notifications: {
              email: true,
              sms: true,
              push: true,
            },
          },
          roles: ["user", "admin"], // Array replaced
        },
      });
    });
  });
});
