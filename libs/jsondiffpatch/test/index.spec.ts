import * as jsondiffpatch from "../src/index.js";

import examples from "./examples/diffpatch.js";

const DiffPatcher = jsondiffpatch.DiffPatcher;

const valueDescription = (value: unknown) => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value.toString();
  }
  if (value instanceof Date) {
    return "Date";
  }
  if (value instanceof RegExp) {
    return "RegExp";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    if (value.length >= 60) {
      return "large text";
    }
  }
  return typeof value;
};

describe("DiffPatcher", () => {
  Object.keys(examples).forEach(groupName => {
    const group = examples[groupName];
    describe(groupName, () => {
      group.forEach(example => {
        if (!example) {
          return;
        }
        const name = example.name || `${valueDescription(example.left)} -> ${valueDescription(example.right)}`;
        describe(name, () => {
          let instance: jsondiffpatch.DiffPatcher;
          beforeAll(function () {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            instance = new DiffPatcher(example.options);
          });
          if (example.error) {
            it(`diff should fail with: ${example.error}`, function () {
              expect(() => {
                instance.diff(example.left, example.right);
              }).toThrow(example.error);
            });
            return;
          }
          it("can diff", function () {
            const delta = instance.diff(example.left, example.right);
            expect(delta).toEqual(example.delta);
          });
          it("can diff backwards", function () {
            const reverse = instance.diff(example.right, example.left);
            expect(reverse).toEqual(example.reverse);
          });
          if (!example.noPatch) {
            it("can patch", function () {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
              const right = instance.patch(example.left, example.delta);
              expect(right).toEqual(example.right);
            });
          }
        });
      });
    });
  });

  describe("static shortcuts", () => {
    it("diff", () => {
      const delta = jsondiffpatch.diff(4, 5);
      expect(delta).toEqual([4, 5]);
    });
    it("patch", () => {
      const right = jsondiffpatch.patch(4, [4, 5]);
      expect(right).toEqual(5);
    });
  });
});
