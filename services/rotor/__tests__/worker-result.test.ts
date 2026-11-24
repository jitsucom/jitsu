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

  it("leaves nothing to normalize alone", () => {
    expect(toJsonEvents([])).toEqual([]);
    expect(toJsonEvents(undefined)).toBeUndefined();
  });

  // The in-process response fails when it is written, and the call answers HTTP 500, which rotor retries. A worker that threw
  // here would turn it into an error entry of an HTTP 200 answer, which is dropped without a retry.
  it("returns events JSON cannot hold as they are, so that writing the response fails as it does in process", () => {
    const withBigInt = [{ properties: { big: 1n } }];
    expect(toJsonEvents(withBigInt)).toBe(withBigInt);
    const cyclic: any = {};
    cyclic.self = cyclic;
    const withCycle = [cyclic];
    expect(toJsonEvents(withCycle)).toBe(withCycle);
    expect(() => JSON.stringify(toJsonEvents(withBigInt))).toThrow();
  });
});
