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

  // What a toJSON throws can be anything, and reading or formatting it can fail itself. That must not escape: the worker's
  // outer catch would answer HTTP 200 with a plain error, which the ingest drops without a retry.
  it("reports the failure whatever was thrown, also a value that cannot be formatted", () => {
    const thrown: Array<() => unknown> = [
      () => Object.create(null),
      () => ({
        get message(): string {
          throw new Error("message getter");
        },
        name: "X",
      }),
      () => ({
        message: "m",
        get name(): string {
          throw new Error("name getter");
        },
      }),
      () => Symbol("sym"),
      () => ({ message: Object.create(null), name: Object.create(null) }),
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error("proxy trap");
            },
          }
        ),
      () => null,
      () => undefined,
      () => 42,
    ];
    for (const [i, make] of thrown.entries()) {
      const events = [
        {
          field: {
            toJSON: () => {
              throw make();
            },
          },
          big: 1n,
        },
      ];
      let json: ReturnType<typeof jsonEventsOf>;
      expect(() => (json = jsonEventsOf(events)), `case ${i}`).not.toThrow();
      expect("error" in json!, `case ${i}`).toBe(true);
      const error = (json! as any).error;
      expect(typeof error.message, `case ${i}`).toBe("string");
      expect(typeof error.name, `case ${i}`).toBe("string");
      expect(error.message.length, `case ${i}`).toBeGreaterThan(0);
      expect(error.name.length, `case ${i}`).toBeGreaterThan(0);
    }
  });
});
