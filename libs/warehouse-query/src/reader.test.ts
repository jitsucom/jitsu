import { describe, expect, it } from "vitest";
import { boundedPreview, previewByteLimit } from "./reader";

describe("preview byte bounds", () => {
  it("checks the overflow row before slicing the displayed rows", () => {
    const rows = Array.from({ length: 100 }, () => ({ value: "small" }));
    rows.push({ value: "x".repeat(previewByteLimit + 1) });
    expect(() => boundedPreview([{ name: "value", type: "25" }], rows)).toThrow(/2 MB/);
  });
  it("preserves row limits and permits a payload-free truncation marker", () => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id }));
    expect(boundedPreview([], rows).truncated).toBe(false);
    expect(boundedPreview([], [...rows, {}])).toEqual({ columns: [], rows, truncated: true });
  });
});
