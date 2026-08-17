/**
 * Minimal OTLP/HTTP Logs protobuf encoder — just enough to serialize an
 * ExportLogsServiceRequest for the observability-exports test action.
 *
 * Hand-encoded on purpose: the only alternative is the @opentelemetry SDK
 * dependency chain, which is built around SDK LogRecord objects and is far
 * heavier than the handful of fixed-field-number messages we need. Field
 * numbers below come from the OTLP protos (opentelemetry-proto v1):
 * collector/logs/v1/logs_service.proto, logs/v1/logs.proto,
 * common/v1/common.proto, resource/v1/resource.proto.
 */

type Writer = { chunks: Buffer[]; length: number };

function newWriter(): Writer {
  return { chunks: [], length: 0 };
}

function push(w: Writer, buf: Buffer) {
  w.chunks.push(buf);
  w.length += buf.length;
}

function toBuffer(w: Writer): Buffer {
  return Buffer.concat(w.chunks, w.length);
}

function varint(n: number | bigint): Buffer {
  let v = BigInt(n);
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) {
      b |= 0x80;
    }
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}

function key(fieldNumber: number, wireType: number): Buffer {
  return varint((fieldNumber << 3) | wireType);
}

function writeVarintField(w: Writer, fieldNumber: number, value: number | bigint) {
  push(w, key(fieldNumber, 0));
  push(w, varint(value));
}

function writeFixed64Field(w: Writer, fieldNumber: number, value: bigint) {
  push(w, key(fieldNumber, 1));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  push(w, buf);
}

function writeBytesField(w: Writer, fieldNumber: number, value: Buffer) {
  push(w, key(fieldNumber, 2));
  push(w, varint(value.length));
  push(w, value);
}

function writeStringField(w: Writer, fieldNumber: number, value: string) {
  writeBytesField(w, fieldNumber, Buffer.from(value, "utf8"));
}

function writeMessageField(w: Writer, fieldNumber: number, message: Writer) {
  writeBytesField(w, fieldNumber, toBuffer(message));
}

// common/v1 AnyValue: string_value=1, bool_value=2, int_value=3, double_value=4,
// array_value=5, kvlist_value=6
function encodeAnyValue(value: unknown): Writer {
  const w = newWriter();
  if (typeof value === "string") {
    writeStringField(w, 1, value);
  } else if (typeof value === "boolean") {
    writeVarintField(w, 2, value ? 1 : 0);
  } else if (typeof value === "number") {
    if (Number.isSafeInteger(value)) {
      // int_value is sint-less int64: negative values need two's-complement varint
      writeVarintField(w, 3, BigInt.asUintN(64, BigInt(value)));
    } else {
      push(w, key(4, 1));
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(value);
      push(w, buf);
    }
  } else if (Array.isArray(value)) {
    const arr = newWriter(); // ArrayValue: values=1
    for (const item of value) {
      writeMessageField(arr, 1, encodeAnyValue(item));
    }
    writeMessageField(w, 5, arr);
  } else if (value !== null && typeof value === "object") {
    const kvlist = newWriter(); // KeyValueList: values=1
    for (const [k, v] of Object.entries(value)) {
      writeMessageField(kvlist, 1, encodeKeyValue(k, v));
    }
    writeMessageField(w, 6, kvlist);
  }
  // null/undefined → empty AnyValue
  return w;
}

// common/v1 KeyValue: key=1, value=2
function encodeKeyValue(k: string, v: unknown): Writer {
  const w = newWriter();
  writeStringField(w, 1, k);
  writeMessageField(w, 2, encodeAnyValue(v));
  return w;
}

export type OtlpLogRecord = {
  timestamp: Date;
  severityNumber: number;
  severityText: string;
  body: unknown;
  attributes: Record<string, unknown>;
};

export type OtlpLogsRequest = {
  resourceAttributes: Record<string, unknown>;
  scopeName: string;
  logRecords: OtlpLogRecord[];
};

export const OTLP_SEVERITY: Record<string, { number: number; text: string }> = {
  debug: { number: 5, text: "DEBUG" },
  info: { number: 9, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
};

export function encodeOtlpLogsRequest(request: OtlpLogsRequest): Buffer {
  // resource/v1 Resource: attributes=1
  const resource = newWriter();
  for (const [k, v] of Object.entries(request.resourceAttributes)) {
    writeMessageField(resource, 1, encodeKeyValue(k, v));
  }

  // common/v1 InstrumentationScope: name=1
  const scope = newWriter();
  writeStringField(scope, 1, request.scopeName);

  // logs/v1 ScopeLogs: scope=1, log_records=2
  const scopeLogs = newWriter();
  writeMessageField(scopeLogs, 1, scope);
  for (const record of request.logRecords) {
    // logs/v1 LogRecord: time_unix_nano=1 (fixed64), severity_number=2,
    // severity_text=3, body=5, attributes=6, observed_time_unix_nano=11 (fixed64)
    const logRecord = newWriter();
    const nanos = BigInt(record.timestamp.getTime()) * 1_000_000n;
    writeFixed64Field(logRecord, 1, nanos);
    writeVarintField(logRecord, 2, record.severityNumber);
    writeStringField(logRecord, 3, record.severityText);
    writeMessageField(logRecord, 5, encodeAnyValue(record.body));
    for (const [k, v] of Object.entries(record.attributes)) {
      writeMessageField(logRecord, 6, encodeKeyValue(k, v));
    }
    writeFixed64Field(logRecord, 11, BigInt(Date.now()) * 1_000_000n);
    writeMessageField(scopeLogs, 2, logRecord);
  }

  // logs/v1 ResourceLogs: resource=1, scope_logs=2
  const resourceLogs = newWriter();
  writeMessageField(resourceLogs, 1, resource);
  writeMessageField(resourceLogs, 2, scopeLogs);

  // collector/logs/v1 ExportLogsServiceRequest: resource_logs=1
  const requestMessage = newWriter();
  writeMessageField(requestMessage, 1, resourceLogs);
  return toBuffer(requestMessage);
}
