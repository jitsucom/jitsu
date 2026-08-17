package api_based

import (
	"encoding/binary"
	"math"
	"time"
)

// Minimal OTLP/HTTP Logs protobuf encoder — just enough to serialize an
// ExportLogsServiceRequest. Hand-encoded to keep bulkerlib free of the
// go.opentelemetry.io/proto dependency chain for a handful of fixed messages
// on a frozen (v1) data model. Field numbers come from the OTLP protos:
// collector/logs/v1/logs_service.proto, logs/v1/logs.proto,
// common/v1/common.proto, resource/v1/resource.proto.
// Mirrors webapps/console/lib/server/otlp-logs.ts — keep the two in sync.

type protoWriter struct {
	buf []byte
}

func (w *protoWriter) varint(v uint64) {
	w.buf = binary.AppendUvarint(w.buf, v)
}

func (w *protoWriter) key(fieldNumber int, wireType int) {
	w.varint(uint64(fieldNumber<<3 | wireType))
}

func (w *protoWriter) varintField(fieldNumber int, v uint64) {
	w.key(fieldNumber, 0)
	w.varint(v)
}

func (w *protoWriter) fixed64Field(fieldNumber int, v uint64) {
	w.key(fieldNumber, 1)
	w.buf = binary.LittleEndian.AppendUint64(w.buf, v)
}

func (w *protoWriter) bytesField(fieldNumber int, v []byte) {
	w.key(fieldNumber, 2)
	w.varint(uint64(len(v)))
	w.buf = append(w.buf, v...)
}

func (w *protoWriter) stringField(fieldNumber int, v string) {
	w.key(fieldNumber, 2)
	w.varint(uint64(len(v)))
	w.buf = append(w.buf, v...)
}

func (w *protoWriter) messageField(fieldNumber int, m *protoWriter) {
	w.bytesField(fieldNumber, m.buf)
}

// common/v1 AnyValue: string_value=1, bool_value=2, int_value=3, double_value=4,
// array_value=5, kvlist_value=6
func encodeAnyValue(value any) *protoWriter {
	w := &protoWriter{}
	switch v := value.(type) {
	case string:
		w.stringField(1, v)
	case bool:
		b := uint64(0)
		if v {
			b = 1
		}
		w.varintField(2, b)
	case float64:
		if v == math.Trunc(v) && math.Abs(v) < 1<<53 {
			// int_value is int64: negative values use two's-complement varint
			w.varintField(3, uint64(int64(v)))
		} else {
			w.key(4, 1)
			w.buf = binary.LittleEndian.AppendUint64(w.buf, math.Float64bits(v))
		}
	case int:
		w.varintField(3, uint64(int64(v)))
	case int64:
		w.varintField(3, uint64(v))
	case []any:
		arr := &protoWriter{} // ArrayValue: values=1
		for _, item := range v {
			arr.messageField(1, encodeAnyValue(item))
		}
		w.messageField(5, arr)
	case map[string]any:
		kvlist := &protoWriter{} // KeyValueList: values=1
		for _, kv := range stableEntries(v) {
			kvlist.messageField(1, encodeKeyValue(kv.key, kv.value))
		}
		w.messageField(6, kvlist)
	}
	// nil and unknown types → empty AnyValue
	return w
}

type entry struct {
	key   string
	value any
}

// map iteration order is random in Go; stable output keeps encoding
// deterministic for tests and for byte-identical retries
func stableEntries(m map[string]any) []entry {
	entries := make([]entry, 0, len(m))
	for k, v := range m {
		entries = append(entries, entry{k, v})
	}
	for i := 1; i < len(entries); i++ {
		for j := i; j > 0 && entries[j-1].key > entries[j].key; j-- {
			entries[j-1], entries[j] = entries[j], entries[j-1]
		}
	}
	return entries
}

// common/v1 KeyValue: key=1, value=2
func encodeKeyValue(k string, v any) *protoWriter {
	w := &protoWriter{}
	w.stringField(1, k)
	w.messageField(2, encodeAnyValue(v))
	return w
}

type otlpLogRecord struct {
	timestamp      time.Time
	severityNumber int
	severityText   string
	body           any
	attributes     []entry
}

type otlpLogsRequest struct {
	resourceAttributes []entry
	scopeName          string
	logRecords         []otlpLogRecord
}

// protoScan walks a protobuf message and calls visit for every field with its
// wire type and payload (varint value for wire type 0, raw bytes for wire type
// 2). Stops silently on malformed input — callers treat that as "not present"
func protoScan(buf []byte, visit func(fieldNumber int, varint uint64, bytes []byte)) {
	pos := 0
	for pos < len(buf) {
		key, n := binary.Uvarint(buf[pos:])
		if n <= 0 {
			return
		}
		pos += n
		fieldNumber := int(key >> 3)
		switch key & 0x7 {
		case 0:
			v, n := binary.Uvarint(buf[pos:])
			if n <= 0 {
				return
			}
			pos += n
			visit(fieldNumber, v, nil)
		case 1:
			pos += 8
		case 5:
			pos += 4
		case 2:
			length, n := binary.Uvarint(buf[pos:])
			// compare in uint64 space: a hostile length > MaxInt64 would wrap
			// negative through int() and slip past an int-space bounds check
			// straight into a slice-bounds panic
			if n <= 0 || length > uint64(len(buf)-pos-n) {
				return
			}
			visit(fieldNumber, 0, buf[pos+n:pos+n+int(length)])
			pos += n + int(length)
		default:
			return
		}
	}
}

// parseOtlpPartialSuccess extracts (rejected_log_records, error_message) from an
// ExportLogsServiceResponse body: partial_success=1 { rejected_log_records=1
// (int64), error_message=2 (string) }. An empty/omitted body means full success;
// malformed bytes return (0, "") — the status code stays the delivery signal
func parseOtlpPartialSuccess(body []byte) (rejected int64, errorMessage string) {
	protoScan(body, func(field int, _ uint64, partial []byte) {
		if field != 1 || partial == nil {
			return
		}
		protoScan(partial, func(field int, varint uint64, bytes []byte) {
			switch {
			case field == 1 && bytes == nil:
				rejected = int64(varint)
			case field == 2 && bytes != nil:
				errorMessage = string(bytes)
			}
		})
	})
	return rejected, errorMessage
}

func encodeOtlpLogsRequest(request *otlpLogsRequest) []byte {
	// resource/v1 Resource: attributes=1
	resource := &protoWriter{}
	for _, kv := range request.resourceAttributes {
		resource.messageField(1, encodeKeyValue(kv.key, kv.value))
	}

	// common/v1 InstrumentationScope: name=1
	scope := &protoWriter{}
	scope.stringField(1, request.scopeName)

	// logs/v1 ScopeLogs: scope=1, log_records=2
	scopeLogs := &protoWriter{}
	scopeLogs.messageField(1, scope)
	observedNanos := uint64(time.Now().UnixNano())
	for _, record := range request.logRecords {
		// logs/v1 LogRecord: time_unix_nano=1 (fixed64), severity_number=2,
		// severity_text=3, body=5, attributes=6, observed_time_unix_nano=11 (fixed64)
		logRecord := &protoWriter{}
		logRecord.fixed64Field(1, uint64(record.timestamp.UnixNano()))
		logRecord.varintField(2, uint64(record.severityNumber))
		logRecord.stringField(3, record.severityText)
		logRecord.messageField(5, encodeAnyValue(record.body))
		for _, kv := range record.attributes {
			logRecord.messageField(6, encodeKeyValue(kv.key, kv.value))
		}
		logRecord.fixed64Field(11, observedNanos)
		scopeLogs.messageField(2, logRecord)
	}

	// logs/v1 ResourceLogs: resource=1, scope_logs=2
	resourceLogs := &protoWriter{}
	resourceLogs.messageField(1, resource)
	resourceLogs.messageField(2, scopeLogs)

	// collector/logs/v1 ExportLogsServiceRequest: resource_logs=1
	requestMessage := &protoWriter{}
	requestMessage.messageField(1, resourceLogs)
	return requestMessage.buf
}
