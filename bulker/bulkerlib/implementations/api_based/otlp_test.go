package api_based

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

func newTestOtlpBulker(t *testing.T, endpoint string) *OtlpBulker {
	b, err := NewOtlpBulker(bulker.Config{
		Id:         "test_otlp",
		BulkerType: OtlpBulkerTypeId,
		DestinationConfig: map[string]any{
			"endpoint": endpoint,
			"headers":  []map[string]any{{"name": "dd-api-key", "value": "test-key"}},
		},
	})
	require.NoError(t, err)
	return b.(*OtlpBulker)
}

func TestOtlpMapLogRecord(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")

	attrsAsMap := func(r otlpLogRecord) map[string]any {
		m := map[string]any{}
		for _, kv := range r.attributes {
			m[kv.key] = kv.value
		}
		return m
	}

	// function log record
	r := b.mapLogRecord(&OtlpEnvelope{
		EventId:      "ev1",
		WorkspaceId:  "ws1",
		MessageId:    "msg1",
		Type:         "function",
		Level:        "error",
		Timestamp:    1700000000000,
		ActorId:      "con1",
		ConnectionId: "con1",
		Body:         map[string]any{"type": "log-error", "functionId": "udf.f1"},
	})
	require.Equal(t, 17, r.severityNumber)
	require.Equal(t, "ERROR", r.severityText)
	require.Equal(t, time.UnixMilli(1700000000000), r.timestamp)
	attrs := attrsAsMap(r)
	require.Equal(t, "ws1", attrs["jitsu.workspace.id"])
	require.Equal(t, "ev1", attrs["jitsu.live_event.id"])
	require.Equal(t, "function", attrs["jitsu.live_event.type"])
	require.Equal(t, "con1", attrs["jitsu.actor.id"])
	require.Equal(t, "msg1", attrs["jitsu.message_id"])
	require.Equal(t, "con1", attrs["jitsu.connection.id"])
	require.NotContains(t, attrs, "jitsu.destination.id")

	// batch/warehouse record: no messageId, destination-scoped
	r = b.mapLogRecord(&OtlpEnvelope{
		EventId:       "ev2",
		WorkspaceId:   "ws1",
		Type:          "bulker_batch",
		Level:         "info",
		Timestamp:     1700000000001,
		ActorId:       "dst1",
		DestinationId: "dst1",
		Body:          map[string]any{"status": "COMPLETED", "processedRows": float64(100)},
	})
	require.Equal(t, 9, r.severityNumber)
	attrs = attrsAsMap(r)
	require.NotContains(t, attrs, "jitsu.message_id")
	require.Equal(t, "dst1", attrs["jitsu.destination.id"])

	// dead-letter record with {payload, error} body; unknown level falls back to info
	r = b.mapLogRecord(&OtlpEnvelope{
		EventId:     "ev3",
		WorkspaceId: "ws1",
		MessageId:   "msg3",
		Type:        "dead-letter",
		Level:       "unknown-level",
		Timestamp:   1700000000002,
		ActorId:     "con2",
		Body:        map[string]any{"payload": `{"event":"x"}`, "error": map[string]any{"functionId": "f2"}},
	})
	require.Equal(t, 9, r.severityNumber)
	require.Equal(t, "INFO", r.severityText)
}

func TestOtlpPresentBody(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")

	// bulker_batch: `status` renamed (Datadog reserved attribute collision) and
	// a message line synthesized from status/rows/target table
	r := b.mapLogRecord(&OtlpEnvelope{
		EventId: "ev1", WorkspaceId: "ws1", Type: "bulker_batch", Level: "info",
		Timestamp: 1700000000000, ActorId: "dst1", DestinationId: "dst1",
		Body: map[string]any{
			"status":         "COMPLETED",
			"processedRows":  float64(2),
			"representation": map[string]any{"name": "events39"},
		},
	})
	body, ok := r.body.(map[string]any)
	require.True(t, ok)
	require.NotContains(t, body, "status")
	require.Equal(t, "COMPLETED", body["record_status"])
	require.Equal(t, "bulker_batch COMPLETED: 2 rows → events39", body["message"])

	// failed batch: error preview appended, long errors truncated
	longErr := strings.Repeat("x", 200)
	r = b.mapLogRecord(&OtlpEnvelope{
		EventId: "ev2", WorkspaceId: "ws1", Type: "bulker_batch", Level: "error",
		Timestamp: 1700000000001, ActorId: "dst1",
		Body: map[string]any{"status": "FAILED", "error": longErr},
	})
	body = r.body.(map[string]any)
	msg := body["message"].(string)
	require.True(t, strings.HasPrefix(msg, "bulker_batch FAILED — "))
	require.True(t, strings.HasSuffix(msg, "…"))
	require.Less(t, len(msg), 200)

	// function log: existing message is never overwritten, no status key → no rename
	r = b.mapLogRecord(&OtlpEnvelope{
		EventId: "ev3", WorkspaceId: "ws1", Type: "function", Level: "info",
		Timestamp: 1700000000002, ActorId: "con1",
		Body: map[string]any{"message": "hello from udf", "type": "log-info"},
	})
	body = r.body.(map[string]any)
	require.Equal(t, "hello from udf", body["message"])
	require.NotContains(t, body, "record_status")

	// the original envelope body must not be mutated (copy semantics)
	orig := map[string]any{"status": "COMPLETED"}
	_ = b.mapLogRecord(&OtlpEnvelope{
		EventId: "ev4", WorkspaceId: "ws1", Type: "bulker_stream", Level: "info",
		Timestamp: 1700000000003, ActorId: "dst1", Body: orig,
	})
	require.Equal(t, map[string]any{"status": "COMPLETED"}, orig)
}

func TestOtlpBuildRequestWireFormat(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")
	envelope := `{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":1700000000000,"actorId":"con1","body":{"hello":"world"}}`
	gzipped, records, err := b.buildRequest(strings.NewReader(envelope + "\n"))
	require.NoError(t, err)
	require.Equal(t, 1, records)

	gz, err := gzip.NewReader(bytes.NewReader(gzipped))
	require.NoError(t, err)
	payload, err := io.ReadAll(gz)
	require.NoError(t, err)

	hexPayload := hex.EncodeToString(payload)
	// ExportLogsServiceRequest.resource_logs: field 1, length-delimited
	require.Equal(t, byte(0x0a), payload[0])
	// Resource attribute KeyValue{key="service.name", value{string_value="jitsu-live-events"}}
	require.Contains(t, hexPayload, hex.EncodeToString([]byte("service.name")))
	require.Contains(t, hexPayload, hex.EncodeToString([]byte(otlpServiceName)))
	// LogRecord.time_unix_nano: field 1 fixed64 of 1700000000000 ms in ns
	nanos := make([]byte, 8)
	binary.LittleEndian.PutUint64(nanos, uint64(1700000000000)*1_000_000)
	require.Contains(t, hexPayload, "09"+hex.EncodeToString(nanos))
	// severity_number: field 2 varint 9
	require.Contains(t, hexPayload, "1009")
	// severity_text: field 3 "INFO"
	require.Contains(t, hexPayload, "1a04"+hex.EncodeToString([]byte("INFO")))
	// body kvlist contains the customer payload
	require.Contains(t, hexPayload, hex.EncodeToString([]byte("hello")))
	require.Contains(t, hexPayload, hex.EncodeToString([]byte("world")))
	// attributes present
	require.Contains(t, hexPayload, hex.EncodeToString([]byte("jitsu.workspace.id")))
	require.Contains(t, hexPayload, hex.EncodeToString([]byte("jitsu.live_event.id")))
}

func TestOtlpBuildRequestSkipsMalformedLines(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")
	input := "not-json\n" +
		// valid JSON that violates the envelope contract is skipped too
		`{"foo":"bar"}` + "\n" +
		`{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":0,"actorId":"a","body":{}}` + "\n" +
		`{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":1,"actorId":"a","body":{}}` + "\n"
	_, records, err := b.buildRequest(strings.NewReader(input))
	require.NoError(t, err)
	require.Equal(t, 1, records)
}

func TestOtlpBuildRequestSkipsOversizedLines(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")
	// a single line over the cap must be skipped without wedging the batch —
	// records before and after it must survive
	oversized := `{"eventId":"big","body":{"x":"` + strings.Repeat("a", maxEnvelopeBytes+1024) + `"}}`
	input := `{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":1,"actorId":"a","body":{}}` + "\n" +
		oversized + "\n" +
		`{"eventId":"ev2","workspaceId":"ws1","type":"function","level":"info","timestamp":2,"actorId":"a","body":{}}` + "\n"
	_, records, err := b.buildRequest(strings.NewReader(input))
	require.NoError(t, err)
	require.Equal(t, 2, records)
}

func TestOtlpBuildRequestFinalLineWithoutNewline(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")
	input := `{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":1,"actorId":"a","body":{}}`
	_, records, err := b.buildRequest(strings.NewReader(input))
	require.NoError(t, err)
	require.Equal(t, 1, records)
}

func otlpEnvelopeLine() string {
	return `{"eventId":"ev1","workspaceId":"ws1","type":"function","level":"info","timestamp":1700000000000,"actorId":"con1","body":{"k":"v"}}` + "\n"
}

func TestOtlpUploadSuccess(t *testing.T) {
	var gotContentType, gotEncoding, gotApiKey string
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		gotContentType = r.Header.Get("Content-Type")
		gotEncoding = r.Header.Get("Content-Encoding")
		gotApiKey = r.Header.Get("dd-api-key")
		w.WriteHeader(200)
	}))
	defer server.Close()

	b := newTestOtlpBulker(t, server.URL)
	status, _, err := b.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
	require.NoError(t, err)
	require.Equal(t, 200, status)
	require.Equal(t, int32(1), requests.Load())
	require.Equal(t, "application/x-protobuf", gotContentType)
	require.Equal(t, "gzip", gotEncoding)
	require.Equal(t, "test-key", gotApiKey)
}

func TestOtlpUploadRetriesTransientThenSucceeds(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) <= 2 {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	}))
	defer server.Close()

	b := newTestOtlpBulker(t, server.URL)
	status, _, err := b.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
	require.NoError(t, err)
	require.Equal(t, 200, status)
	require.Equal(t, int32(3), requests.Load())
}

func TestOtlpUploadPermanentErrorNoRetry(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(401)
	}))
	defer server.Close()

	b := newTestOtlpBulker(t, server.URL)
	status, _, err := b.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
	require.Error(t, err)
	require.Equal(t, 401, status)
	require.Equal(t, int32(1), requests.Load())
}

func TestOtlpUploadTransientExhaustsRetries(t *testing.T) {
	for _, transientStatus := range []int{429, 504} {
		var requests atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests.Add(1)
			w.WriteHeader(transientStatus)
		}))

		b := newTestOtlpBulker(t, server.URL)
		_, _, err := b.Upload(strings.NewReader(otlpEnvelopeLine()), "live_events", 1, nil)
		require.Error(t, err)
		require.Equal(t, int32(len(retryDelaysMs)), requests.Load())
		server.Close()
	}
}

func TestOtlpUploadEmptyBatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("no request expected for an empty batch")
	}))
	defer server.Close()

	b := newTestOtlpBulker(t, server.URL)
	status, _, err := b.Upload(strings.NewReader(""), "live_events", 0, nil)
	require.NoError(t, err)
	require.Equal(t, 200, status)
}

func TestOtlpParsePartialSuccess(t *testing.T) {
	// hand-encode ExportLogsServiceResponse{partial_success: {rejected_log_records: 3, error_message: "boom"}}
	partial := &protoWriter{}
	partial.varintField(1, 3)
	partial.stringField(2, "boom")
	response := &protoWriter{}
	response.messageField(1, partial)

	rejected, message := parseOtlpPartialSuccess(response.buf)
	require.Equal(t, int64(3), rejected)
	require.Equal(t, "boom", message)

	// empty body = full success; garbage is treated as absent
	rejected, message = parseOtlpPartialSuccess(nil)
	require.Equal(t, int64(0), rejected)
	require.Empty(t, message)
	rejected, message = parseOtlpPartialSuccess([]byte("not-protobuf"))
	require.Empty(t, message)

	// hostile length prefix > MaxInt64 must not panic (int() would wrap negative)
	overflow := append([]byte{0x0a}, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01)
	require.NotPanics(t, func() { parseOtlpPartialSuccess(overflow) })
}

func TestOtlpStreamModesRejected(t *testing.T) {
	b := newTestOtlpBulker(t, "https://example.com/v1/logs")
	for _, mode := range []bulker.BulkMode{bulker.Stream, bulker.ReplaceTable, bulker.ReplacePartition} {
		_, err := b.CreateStream("id", "live_events", mode)
		require.Error(t, err)
	}
}
