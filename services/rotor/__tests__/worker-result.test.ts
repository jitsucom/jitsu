import { describe, expect, it } from "vitest";
import { toJsonEvents } from "../src/lib/worker-result";

// A worker answers with postMessage (structured clone); the in-process response is JSON. The destination has to get the same
// event from both.
describe("toJsonEvents", () => {
  const event = () => ({
    type: "track",
    properties: {
      link: new URL("https://example.com/a?b=1"),
      when: new Date("2026-01-02T03:04:05.000Z"),
      own: { toJSON: () => "own-json-form" },
      gone: undefined as any,
      n: 1,
      nested: [{ u: new URL("https://example.com/n") }],
    },
  });

  it("is what the JSON response makes of the events", () => {
    const events = [event()];
    expect(toJsonEvents(events)).toEqual(JSON.parse(JSON.stringify(events)));
    expect(toJsonEvents(events)[0].properties).toEqual({
      link: "https://example.com/a?b=1",
      when: "2026-01-02T03:04:05.000Z",
      own: "own-json-form",
      n: 1,
      nested: [{ u: "https://example.com/n" }],
    });
  });

  it("survives the clone of a worker message unchanged", () => {
    const events = toJsonEvents([event()]);
    expect(structuredClone(events)).toEqual(events);
  });

  it("leaves nothing to normalize alone, and fails where the JSON response fails", () => {
    expect(toJsonEvents([])).toEqual([]);
    expect(toJsonEvents(undefined)).toBeUndefined();
    expect(() => toJsonEvents([{ big: 1n }])).toThrow();
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(() => toJsonEvents([cyclic])).toThrow();
  });
});
