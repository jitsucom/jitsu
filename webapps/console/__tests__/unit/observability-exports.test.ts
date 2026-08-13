import { describe, expect, it } from "vitest";
import {
  defaultObservabilityExportsSettings,
  maskObservabilityExportsSettings,
  ObservabilityExportsSettings,
  unmaskObservabilityExportsSettings,
} from "../../lib/shared/observability-exports";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { encodeOtlpLogsRequest, OTLP_SEVERITY } from "../../lib/server/otlp-logs";

describe("observability-exports settings schema", () => {
  it("accepts a valid enabled config", () => {
    const parsed = ObservabilityExportsSettings.parse({
      enabled: true,
      endpoint: "https://otlp.datadoghq.com/v1/logs",
      headers: [{ name: "dd-api-key", value: "secret" }],
    });
    expect(parsed.enabled).toBe(true);
  });

  it("rejects an enabled config with an invalid endpoint", () => {
    expect(ObservabilityExportsSettings.safeParse({ enabled: true, endpoint: "not-a-url", headers: [] }).success).toBe(
      false
    );
    expect(
      ObservabilityExportsSettings.safeParse({ enabled: true, endpoint: "ftp://x/v1/logs", headers: [] }).success
    ).toBe(false);
  });

  it("allows a disabled config with an empty endpoint", () => {
    expect(ObservabilityExportsSettings.parse(defaultObservabilityExportsSettings).enabled).toBe(false);
  });

  it("validates the endpoint even when disabled, if one is set", () => {
    expect(ObservabilityExportsSettings.safeParse({ enabled: false, endpoint: "not-a-url", headers: [] }).success).toBe(
      false
    );
  });

  it("rejects duplicate header names, case-insensitively", () => {
    expect(
      ObservabilityExportsSettings.safeParse({
        enabled: false,
        endpoint: "",
        headers: [
          { name: "dd-api-key", value: "a" },
          { name: "DD-API-KEY", value: "b" },
        ],
      }).success
    ).toBe(false);
  });
});

describe("header value masking", () => {
  const stored = ObservabilityExportsSettings.parse({
    enabled: true,
    endpoint: "https://otlp.example.com/v1/logs",
    headers: [
      { name: "dd-api-key", value: "real-secret" },
      { name: "x-empty", value: "" },
    ],
  });

  it("masks non-empty values on read", () => {
    const masked = maskObservabilityExportsSettings(stored);
    expect(masked.headers).toEqual([
      { name: "dd-api-key", value: MASKED_SECRET },
      { name: "x-empty", value: "" },
    ]);
  });

  it("round-trips: writing the masked settings back preserves stored values", () => {
    const masked = maskObservabilityExportsSettings(stored);
    const unmasked = unmaskObservabilityExportsSettings(masked, stored);
    expect(unmasked).toEqual(stored);
  });

  it("replaces a value when the client sends a new one", () => {
    const masked = maskObservabilityExportsSettings(stored);
    masked.headers[0] = { name: "dd-api-key", value: "new-secret" };
    const unmasked = unmaskObservabilityExportsSettings(masked, stored);
    expect(unmasked.headers[0].value).toBe("new-secret");
  });

  it("does not resurrect a stored value for a renamed header", () => {
    const unmasked = unmaskObservabilityExportsSettings(
      { ...stored, headers: [{ name: "renamed", value: MASKED_SECRET }] },
      stored
    );
    expect(unmasked.headers[0].value).toBe("");
  });
});

// Reference encodings verified against protoc --encode with the OTLP protos:
// field numbers/wire types per opentelemetry-proto v1
describe("otlp logs protobuf encoder", () => {
  it("encodes a minimal request with the expected wire format", () => {
    const buf = encodeOtlpLogsRequest({
      resourceAttributes: { "service.name": "jitsu-live-events" },
      scopeName: "jitsu",
      logRecords: [
        {
          timestamp: new Date(1700000000000),
          severityNumber: OTLP_SEVERITY.info.number,
          severityText: OTLP_SEVERITY.info.text,
          body: "hello",
          attributes: { "jitsu.test": true },
        },
      ],
    });
    // ExportLogsServiceRequest.resource_logs is field 1, length-delimited
    expect(buf[0]).toBe(0x0a);
    // resource_logs.resource (field 1) with the service.name attribute
    const hex = buf.toString("hex");
    // KeyValue{key="service.name" value{string_value="jitsu-live-events"}}
    expect(hex).toContain(Buffer.from("service.name", "utf8").toString("hex"));
    expect(hex).toContain(Buffer.from("jitsu-live-events", "utf8").toString("hex"));
    // LogRecord.time_unix_nano: field 1, fixed64 of 1700000000000 * 1e6 ns
    const nanos = Buffer.alloc(8);
    nanos.writeBigUInt64LE(1700000000000n * 1_000_000n);
    expect(hex).toContain("09" + nanos.toString("hex"));
    // LogRecord.severity_number: field 2 varint 9 → 0x10 0x09
    expect(hex).toContain("1009");
    // LogRecord.severity_text: field 3 string "INFO"
    expect(hex).toContain("1a04" + Buffer.from("INFO", "utf8").toString("hex"));
    // body (field 5) AnyValue.string_value (field 1) "hello"
    expect(hex).toContain("2a070a05" + Buffer.from("hello", "utf8").toString("hex"));
    // attribute KeyValue{key="jitsu.test" value{bool_value=true}} — bool_value is field 2 varint
    expect(hex).toContain(Buffer.from("jitsu.test", "utf8").toString("hex") + "12021001");
  });

  it("encodes structured bodies as kvlist with nested types", () => {
    const buf = encodeOtlpLogsRequest({
      resourceAttributes: {},
      scopeName: "jitsu",
      logRecords: [
        {
          timestamp: new Date(0),
          severityNumber: 17,
          severityText: "ERROR",
          body: { error: "boom", count: 2, nested: { ok: false }, list: ["a", 1.5] },
          attributes: {},
        },
      ],
    });
    const hex = buf.toString("hex");
    expect(hex).toContain(Buffer.from("error", "utf8").toString("hex"));
    expect(hex).toContain(Buffer.from("boom", "utf8").toString("hex"));
    // int_value (field 3) varint 2 → 0x18 0x02
    expect(hex).toContain("1802");
    // double 1.5 little-endian fixed64 under AnyValue.double_value (field 4, wire type 1 → 0x21)
    const dbl = Buffer.alloc(8);
    dbl.writeDoubleLE(1.5);
    expect(hex).toContain("21" + dbl.toString("hex"));
  });

  it("survives negative integers via two's-complement int64", () => {
    const buf = encodeOtlpLogsRequest({
      resourceAttributes: {},
      scopeName: "jitsu",
      logRecords: [
        {
          timestamp: new Date(0),
          severityNumber: 9,
          severityText: "INFO",
          body: { delta: -1 },
          attributes: {},
        },
      ],
    });
    // -1 as uint64 varint: 10 bytes of 0xff… ending 0x01
    expect(buf.toString("hex")).toContain("18ffffffffffffffffff01");
  });
});
