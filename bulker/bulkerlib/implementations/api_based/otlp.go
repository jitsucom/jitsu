package api_based

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

// OTLP live-events export destination (JITSU-138): posts Live Events records to a
// customer's OTLP/HTTP logs endpoint as protobuf. One synthesized internal
// connection per enabled workspace (see the console's bulker-connections export);
// batch mode only, riding the standard batch consumer + retry-topic machinery.
const OtlpBulkerTypeId = "otlp"
const OtlpUnsupported = "Only 'batch' mode is supported"

const otlpServiceName = "jitsu-live-events"

// records bigger than this are skipped, not batch-failing: a bufio.Scanner-style
// hard stop would redeliver the same batch through the retry machinery and wedge
// the workspace's export forever on a single oversized record
const maxEnvelopeBytes = 20 * 1024 * 1024

func init() {
	bulker.RegisterBulker(OtlpBulkerTypeId, NewOtlpBulker)
}

type OtlpHeader struct {
	Name  string `mapstructure:"name" json:"name" yaml:"name"`
	Value string `mapstructure:"value" json:"value" yaml:"value"`
}

type OtlpConfig struct {
	Endpoint string       `mapstructure:"endpoint" json:"endpoint" yaml:"endpoint"`
	Headers  []OtlpHeader `mapstructure:"headers" json:"headers" yaml:"headers"`
}

// OtlpEnvelope is the record shape events-log write sites produce into the
// otlp destination's `live_events` topic. Producers live in the eventslog
// package (Go) and rotor (TS) — keep the three shapes in sync.
type OtlpEnvelope struct {
	EventId          string         `json:"eventId"`
	WorkspaceId      string         `json:"workspaceId"`
	MessageId        string         `json:"messageId,omitempty"`
	Type             string         `json:"type"`
	Level            string         `json:"level"`
	Timestamp        int64          `json:"timestamp"` // unix millis of the original Live Events record
	ActorId          string         `json:"actorId"`
	ConnectionId     string         `json:"connectionId,omitempty"`
	DestinationId    string         `json:"destinationId,omitempty"`
	ProfileBuilderId string         `json:"profileBuilderId,omitempty"`
	Body             map[string]any `json:"body"`
}

// severity mapping per the OpenTelemetry Logs data model: each conventional
// level owns a 4-number range; we use the first slot
var otlpSeverity = map[string]struct {
	number int
	text   string
}{
	"debug": {5, "DEBUG"},
	"info":  {9, "INFO"},
	"warn":  {13, "WARN"},
	"error": {17, "ERROR"},
}

type OtlpBulker struct {
	appbase.Service
	config         OtlpConfig
	httpClient     *http.Client
	serviceVersion string

	closed *atomic.Bool
}

func NewOtlpBulker(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := OtlpConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, &config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	if config.Endpoint == "" {
		return nil, errors.New("otlp destination requires an endpoint")
	}
	httpClient := &http.Client{
		Timeout: time.Duration(15) * time.Second,
	}
	return &OtlpBulker{
		Service:        appbase.NewServiceBase(OtlpBulkerTypeId),
		config:         config,
		httpClient:     httpClient,
		serviceVersion: os.Getenv("VERSION"),
		closed:         &atomic.Bool{},
	}, nil
}

func (o *OtlpBulker) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	if mode != bulker.Batch {
		return nil, errors.New(OtlpUnsupported)
	}
	return NewTransactionalStream(id, o, tableName, streamOptions...)
}

func (o *OtlpBulker) Type() string {
	return OtlpBulkerTypeId
}

func (o *OtlpBulker) mapLogRecord(envelope *OtlpEnvelope) otlpLogRecord {
	severity, ok := otlpSeverity[envelope.Level]
	if !ok {
		severity = otlpSeverity["info"]
	}
	// workspace/event fields stay log attributes, never resource attributes —
	// resource identity must remain low-cardinality (service name/version only)
	attributes := []entry{
		{"jitsu.workspace.id", envelope.WorkspaceId},
		{"jitsu.live_event.id", envelope.EventId},
		{"jitsu.live_event.type", envelope.Type},
		{"jitsu.actor.id", envelope.ActorId},
	}
	if envelope.MessageId != "" {
		attributes = append(attributes, entry{"jitsu.message_id", envelope.MessageId})
	}
	if envelope.ConnectionId != "" {
		attributes = append(attributes, entry{"jitsu.connection.id", envelope.ConnectionId})
	}
	if envelope.DestinationId != "" {
		attributes = append(attributes, entry{"jitsu.destination.id", envelope.DestinationId})
	}
	if envelope.ProfileBuilderId != "" {
		attributes = append(attributes, entry{"jitsu.profile_builder.id", envelope.ProfileBuilderId})
	}
	var body any
	if envelope.Body != nil {
		body = envelope.Body
	}
	return otlpLogRecord{
		timestamp:      time.UnixMilli(envelope.Timestamp),
		severityNumber: severity.number,
		severityText:   severity.text,
		body:           body,
		attributes:     attributes,
	}
}

func (o *OtlpBulker) buildRequest(reader io.Reader) ([]byte, int, error) {
	request := &otlpLogsRequest{
		resourceAttributes: []entry{{"service.name", otlpServiceName}},
		scopeName:          "jitsu",
	}
	if o.serviceVersion != "" {
		request.resourceAttributes = append(request.resourceAttributes, entry{"service.version", o.serviceVersion})
	}
	br := bufio.NewReaderSize(reader, 64*1024)
	skipped := 0
	oversized := 0
	for {
		line, tooLong, err := readEnvelopeLine(br, maxEnvelopeBytes)
		eof := errors.Is(err, io.EOF)
		if err != nil && !eof {
			return nil, 0, fmt.Errorf("failed to read batch: %v", err)
		}
		if tooLong {
			oversized++
		} else if trimmed := bytes.TrimSpace(line); len(trimmed) > 0 {
			envelope := OtlpEnvelope{}
			if err := jsoniter.Unmarshal(trimmed, &envelope); err != nil {
				skipped++
				o.Errorf("skipping malformed live-events envelope: %v", err)
			} else if envelope.EventId == "" || envelope.WorkspaceId == "" || envelope.ActorId == "" ||
				envelope.Type == "" || envelope.Timestamp <= 0 {
				// valid JSON that violates the envelope contract is as unexportable
				// as unparseable JSON — skip it rather than emit a junk LogRecord
				skipped++
				o.Errorf("skipping invalid live-events envelope: missing required fields")
			} else {
				request.logRecords = append(request.logRecords, o.mapLogRecord(&envelope))
			}
		}
		if eof {
			break
		}
	}
	if skipped > 0 {
		o.Errorf("skipped %d malformed envelopes in batch", skipped)
	}
	if oversized > 0 {
		o.Errorf("skipped %d oversized envelopes (> %d bytes) in batch", oversized, maxEnvelopeBytes)
	}
	if len(request.logRecords) == 0 {
		return nil, 0, nil
	}
	payload := encodeOtlpLogsRequest(request)
	var gzipped bytes.Buffer
	gz := gzip.NewWriter(&gzipped)
	if _, err := gz.Write(payload); err != nil {
		return nil, 0, err
	}
	if err := gz.Close(); err != nil {
		return nil, 0, err
	}
	return gzipped.Bytes(), len(request.logRecords), nil
}

// readEnvelopeLine reads one newline-terminated line, accumulating ReadLine
// fragments. Lines longer than maxBytes are consumed to their end and reported
// as tooLong with no content, so the caller can skip them and keep reading —
// unlike bufio.Scanner, which cannot resume after ErrTooLong
func readEnvelopeLine(br *bufio.Reader, maxBytes int) (line []byte, tooLong bool, err error) {
	for {
		var chunk []byte
		var isPrefix bool
		chunk, isPrefix, err = br.ReadLine()
		if err != nil {
			// bufio.ReadLine never returns data together with an error
			return line, tooLong, err
		}
		if !tooLong {
			line = append(line, chunk...)
			if len(line) > maxBytes {
				line = nil
				tooLong = true
			}
		}
		if !isPrefix {
			return line, tooLong, nil
		}
	}
}

func (o *OtlpBulker) Upload(reader io.Reader, _ string, _ int, _ map[string]any) (statusCode int, respBody string, err error) {
	if o.closed.Load() {
		return 0, "", fmt.Errorf("attempt to use closed OTLP instance")
	}
	body, records, err := o.buildRequest(reader)
	if err != nil {
		return 0, "", err
	}
	if records == 0 {
		return 200, "", nil
	}
	for _, retryDelayMs := range retryDelaysMs {
		var req *http.Request
		req, err = http.NewRequest("POST", o.config.Endpoint, bytes.NewReader(body))
		if err != nil {
			return 0, "", err
		}
		req.Header.Set("Content-Type", "application/x-protobuf")
		req.Header.Set("Content-Encoding", "gzip")
		for _, header := range o.config.Headers {
			req.Header.Set(header.Name, header.Value)
		}
		var res *http.Response
		res, err = o.httpClient.Do(req)
		if err != nil {
			// network errors and timeouts: transient, retry in-process
			statusCode = 0
			respBody = ""
			time.Sleep(time.Duration(retryDelayMs) * time.Millisecond)
			continue
		}
		var bodyBytes []byte
		bodyBytes, err = io.ReadAll(res.Body)
		_ = res.Body.Close()
		respBody = string(bodyBytes)
		statusCode = res.StatusCode
		errText := ""
		if err != nil {
			errText = ": " + err.Error()
		}
		switch {
		case statusCode >= 200 && statusCode < 300:
			return statusCode, respBody, nil
		case statusCode == 429 || statusCode == 500 || statusCode == 502 || statusCode == 503 || statusCode == 504:
			// standard OTLP retryable statuses: retry in-process, and if the
			// budget runs out the returned error sends the batch through the
			// batch consumer's retry-topic machinery
			err = o.NewError("http status: %v%s", statusCode, errText)
			time.Sleep(time.Duration(retryDelayMs) * time.Millisecond)
			continue
		default:
			// permanent (bad endpoint/auth/payload): fail the batch without
			// in-process retries; server-side logging only in V1
			return statusCode, respBody, o.NewError("http status: %v%s", statusCode, errText)
		}
	}
	return
}

func (o *OtlpBulker) GetBatchFileFormat() types2.FileFormat {
	return types2.FileFormatNDJSON
}

func (o *OtlpBulker) GetBatchFileCompression() types2.FileCompression {
	return types2.FileCompressionNONE
}

func (o *OtlpBulker) InmemoryBatch() bool {
	return true
}

func (o *OtlpBulker) Close() error {
	o.closed.Store(true)
	o.httpClient.CloseIdleConnections()
	return nil
}
