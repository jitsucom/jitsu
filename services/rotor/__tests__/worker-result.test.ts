import { describe, expect, it } from "vitest";
import { jsonEventsOf } from "../src/lib/worker-result";

// A worker answers with postMessage (structured clone); the in-process response is JSON. The destination has to get the same
// event from both, and an event the response cannot write has to fail the call in both.
describe("jsonEventsOf", () => {
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
    const json = jsonEventsOf(events);
    expect(json).toEqual({ events: JSON.parse(JSON.stringify(events)) });
    expect((json as any).events[0].properties).toEqual({
      link: "https://example.com/a?b=1",
      when: "2026-01-02T03:04:05.000Z",
      own: "own-json-form",
      n: 1,
      nested: [{ u: "https://example.com/n" }],
    });
  });

  it("survives the clone of a worker message unchanged", () => {
    const { events } = jsonEventsOf([event()]) as { events: unknown[] };
    expect(structuredClone(events)).toEqual(events);
  });

  it("leaves nothing to normalize alone", () => {
    expect(jsonEventsOf([])).toEqual({ events: [] });
    expect(jsonEventsOf(undefined)).toEqual({ events: undefined });
  });

  // The in-process response fails when it writes such events, and the call answers HTTP 500, which rotor retries. A clone
  // would carry a BigInt on and strip the class of an object whose toJSON throws, so the failure is sent explicitly.
  it("reports events JSON cannot hold, whatever the reason, instead of passing them on", () => {
    class Throwing {
      value = 1;
      toJSON(): never {
        throw new Error("toJSON failed");
      }
    }
    const cyclic: any = {};
    cyclic.self = cyclic;
    for (const events of [[{ big: 1n }], [cyclic], [{ field: new Throwing() }]]) {
      const json = jsonEventsOf(events);
      expect("error" in json, JSON.stringify(Object.keys(json))).toBe(true);
      expect((json as any).error.message.length).toBeGreaterThan(0);
    }
    expect((jsonEventsOf([{ field: new Throwing() }]) as any).error).toEqual({
      message: "toJSON failed",
      name: "Error",
    });
    expect((jsonEventsOf([{ big: 1n }]) as any).error.name).toBe("TypeError");
  });
});
