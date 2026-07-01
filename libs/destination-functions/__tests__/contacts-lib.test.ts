import { expect, test } from "vitest";
import {
  decodeManagedIds,
  desiredTargetNames,
  encodeManagedIds,
  resolveEmail,
  splitCsv,
  splitName,
} from "../src/functions/lib/contacts";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

test("splitName handles camelCase, snake_case, and full name", () => {
  expect(splitName({ firstName: "Dwight", lastName: "Schrute" })).toEqual({
    first_name: "Dwight",
    last_name: "Schrute",
  });
  // snake_case must not be dropped (regression: it was reserved out of properties but never read here)
  expect(splitName({ first_name: "Dwight", last_name: "Schrute" })).toEqual({
    first_name: "Dwight",
    last_name: "Schrute",
  });
  expect(splitName({ name: "Dwight Kurt Schrute" })).toEqual({ first_name: "Dwight", last_name: "Kurt Schrute" });
  expect(splitName({ name: "Dwight" })).toEqual({ first_name: "Dwight", last_name: undefined });
  expect(splitName({})).toEqual({});
});

test("splitCsv trims, drops blanks, de-duplicates", () => {
  expect(splitCsv("a, b ,a,, c")).toEqual(["a", "b", "c"]);
  expect(splitCsv("")).toEqual([]);
  expect(splitCsv(undefined)).toEqual([]);
});

test("encode/decodeManagedIds round-trips, empty set stays representable", () => {
  expect(encodeManagedIds(["x", "y"])).toBe("[x,y]");
  expect(encodeManagedIds([])).toBe("[]");
  expect(decodeManagedIds("[x,y]")).toEqual(["x", "y"]);
  expect(decodeManagedIds("[]")).toEqual([]);
  // tolerates a bare (legacy/unwrapped) value too
  expect(decodeManagedIds("x,y")).toEqual(["x", "y"]);
  expect(decodeManagedIds(undefined)).toEqual([]);
});

test("resolveEmail reads traits then context.traits", () => {
  expect(resolveEmail({ traits: { email: "a@x.com" }, context: {} } as AnalyticsServerEvent)).toBe("a@x.com");
  expect(resolveEmail({ context: { traits: { email: "b@x.com" } } } as AnalyticsServerEvent)).toBe("b@x.com");
  expect(resolveEmail({ context: {} } as AnalyticsServerEvent)).toBeUndefined();
});

test("desiredTargetNames: override trait wins (even empty), else config, else undefined", () => {
  const ev = (traits: any) => ({ traits, context: {} } as AnalyticsServerEvent);
  expect(desiredTargetNames(ev({ t: "A, B" }), "t", "X")).toEqual(["A", "B"]);
  expect(desiredTargetNames(ev({ t: "" }), "t", "X")).toEqual([]); // explicit clear
  expect(desiredTargetNames(ev({}), "t", "X, Y")).toEqual(["X", "Y"]); // fall back to config
  expect(desiredTargetNames(ev({}), "t", undefined)).toBeUndefined(); // nothing specified
});
