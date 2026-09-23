import { describe, expect, it } from "vitest";
import { canonicalJson } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { decodeJson, encodeJson, jsonByteBudget } from "./serialization";

describe("plain JSON persistence", () => {
  it("round-trips readable, deterministic UTF-8 JSON with exact byte accounting", () => {
    const value = { email: "alice@example.com", name: "Հայերեն", nested: [null, true, "\u0000"] };
    const encoded = encodeJson(value);
    expect(JSON.parse(encoded.toString())).toEqual({ version: 1, value });
    expect(decodeJson(encoded)).toEqual(value);
    expect(encodeJson({ nested: value.nested, name: value.name, email: value.email })).toEqual(encoded);
    expect(encoded.length).toBe(jsonByteBudget(Buffer.byteLength(canonicalJson(value))));
  });
  it("enforces payload byte limits without counting characters or requiring keys", () => {
    const value = { text: "é" };
    const bytes = Buffer.byteLength(canonicalJson(value));
    expect(() => encodeJson(value, bytes - 1)).toThrow(/byte budget/);
    expect(decodeJson(encodeJson(value, bytes))).toEqual(value);
  });
  it.each([
    '{"private@example.com":',
    "null",
    '{"version":2,"value":{}}',
    '{"version":1}',
    '{"key":"old","nonce":"abc","tag":"abc","data":"abc"}',
  ])("rejects invalid or unsupported formats without exposing their contents (%#)", value => {
    expect(() => decodeJson(Buffer.from(value))).toThrow(
      "Recovery data could not be decoded; unsupported or invalid persistence format"
    );
  });
});
