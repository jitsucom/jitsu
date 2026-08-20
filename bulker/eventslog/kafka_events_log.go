package eventslog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/types"
)

// Live Events observability export fan-out (JITSU-138): a KafkaEventsLogService
// composed alongside the ClickHouse/Redis service publishes exportable records
// into the workspace's otlp destination topic, and one active_incoming billing
// record per exported envelope. Delivery failures never block or delay the
// primary events-log write — production is fire-and-forget.

// ExportEnvelope mirrors api_based.OtlpEnvelope in bulkerlib and the rotor (TS)
// producer — keep the three shapes in sync
type ExportEnvelope struct {
	EventId          string `json:"eventId"`
	WorkspaceId      string `json:"workspaceId"`
	MessageId        string `json:"messageId,omitempty"`
	Type             string `json:"type"`
	Level            string `json:"level"`
	Timestamp        int64  `json:"timestamp"`
	ActorId          string `json:"actorId"`
	ConnectionId     string `json:"connectionId,omitempty"`
	DestinationId    string `json:"destinationId,omitempty"`
	ProfileBuilderId string `json:"profileBuilderId,omitempty"`
	Body             any    `json:"body"`
}

// ActiveIncomingRecord is one row of the active_incoming billing flow —
// same shape as ingest's emitSyncMetrics and rotor's metrics.ts
type ActiveIncomingRecord struct {
	Timestamp   string `json:"timestamp"`
	WorkspaceId string `json:"workspaceId"`
	MessageId   string `json:"messageId"`
}

// OtlpDestinationIdSuffix: the console synthesizes one otlp connection per
// enabled workspace with id {workspaceId}_otlp (see the bulker-connections export)
const OtlpDestinationIdSuffix = "_otlp"

const exportTableName = "live_events"

// ExportEventId derives the per-record id: a content hash minted once at
// publish time, so export/delivery retries of the same envelope carry the same
// id and the billing flow's uniqState(messageId) dedup collapses them.
// Pipeline reprocessing that re-emits a log record produces a new record (new
// timestamp) — it is delivered and billed again, matching the at-least-once
// semantics of the Live Events store itself. Same recipe in rotor (TS)
func ExportEventId(actorId string, timestamp time.Time, payload []byte) string {
	h := sha256.New()
	h.Write([]byte(actorId))
	h.Write([]byte("|"))
	h.Write([]byte(fmt.Sprintf("%d", timestamp.UnixMilli())))
	h.Write([]byte("|"))
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// jsonCanonical serializes the eventId hash input: sorted map keys make the
// bytes deterministic for plain map bodies (ConfigDefault preserves Go's
// random map iteration order, which would break hash stability); OrderedMap
// values are already deterministic via insertion order. The envelope itself
// still uses ConfigDefault so exported bodies keep their natural field order
var jsonCanonical = jsonorder.Config{
	EscapeHTML:                    false,
	UseNumber:                     true,
	ObjectFieldMustBeSimpleString: true,
	SortMapKeys:                   true,
}.Froze()

// ExportProduceFunc produces one message to a Kafka topic. Implementations must
// be async/non-blocking — export must never delay events-log writes. The
// returned error reports synchronous enqueue failure (queue full, unknown
// topic, closed producer); async delivery failures are out of scope
type ExportProduceFunc func(topic string, key string, payload []byte) error

type KafkaEventsLogConfig struct {
	// KafkaTopicPrefix as configured for the destination topics grammar
	KafkaTopicPrefix string
	// MetricsDestinationId — the special metrics destination ("metrics" by default)
	MetricsDestinationId string
	// OtlpEnabled returns true when the workspace has an otlp export destination.
	// Presence of the synthesized {workspaceId}_otlp connection is the source of truth
	OtlpEnabled func(workspaceId string) bool
	Produce     ExportProduceFunc
}

type KafkaEventsLogService struct {
	config KafkaEventsLogConfig
}

func NewKafkaEventsLogService(config KafkaEventsLogConfig) *KafkaEventsLogService {
	return &KafkaEventsLogService{config: config}
}

func (k *KafkaEventsLogService) Id() string {
	return "kafka-export"
}

// exportable: only function, bulker_batch and bulker_stream records are
// published. incoming is excluded by spec. The otlp destination's own batch
// records are excluded too (self-export loop guard) — they stay visible in
// Live Events but are never exported or billed
func (k *KafkaEventsLogService) exportable(event *ActorEvent) bool {
	switch event.EventType {
	case EventTypeFunction, EventTypeBatch, EventTypeProcessed:
	default:
		return false
	}
	if event.WorkspaceId == "" {
		return false
	}
	// exact match: only the workspace's own synthesized otlp destination is
	// excluded — a customer destination that happens to end with _otlp is not
	if event.ActorId == event.WorkspaceId+OtlpDestinationIdSuffix {
		return false
	}
	return k.config.OtlpEnabled(event.WorkspaceId)
}

func (k *KafkaEventsLogService) PostAsync(event *ActorEvent) {
	if !k.exportable(event) {
		return
	}
	timestamp := event.Timestamp
	if timestamp.IsZero() {
		timestamp = time.Now()
	}
	// jsonorder, NOT encoding/json: event bodies carry OrderedMap values
	// (lastMappedRow, representation.schema, statistics.states) that only the
	// jsonorder codec can serialize — encoding/json renders them as {} (the
	// ClickHouse events log uses jsonorder for the same reason)
	body, err := jsonCanonical.Marshal(event.Event)
	if err != nil {
		logging.Errorf("[kafka-export] failed to marshal event body for %s/%s: %v", event.WorkspaceId, event.ActorId, err)
		return
	}
	envelope := ExportEnvelope{
		EventId:     ExportEventId(event.ActorId, timestamp, body),
		WorkspaceId: event.WorkspaceId,
		MessageId:   event.MessageId,
		Type:        string(event.EventType),
		Level:       string(event.Level),
		Timestamp:   timestamp.UnixMilli(),
		ActorId:     event.ActorId,
		Body:        event.Event,
	}
	switch event.EventType {
	case EventTypeFunction:
		envelope.ConnectionId = event.ActorId
	case EventTypeBatch, EventTypeProcessed:
		envelope.DestinationId = event.ActorId
		// bulker_batch / bulker_stream bodies are constructed by bulker itself
		// (bulker.State / stream status shapes), so we own their top-level keys
		// and adapt them for observability backends here, at the producer —
		// the otlp destination stays payload-agnostic. Function-log bodies are
		// user data and are never touched. The eventId hash above is computed
		// from the unadapted body, so the id is unaffected
		if adapted := adaptOwnedBody(body, string(event.EventType)); adapted != nil {
			envelope.Body = adapted
		}
	}
	payload, err := jsonorder.Marshal(&envelope)
	if err != nil {
		logging.Errorf("[kafka-export] failed to marshal export envelope for %s/%s: %v", event.WorkspaceId, event.ActorId, err)
		return
	}
	// topic grammar: {prefix}in.id.{destinationId}.m.batch.t.{table}
	exportTopic := fmt.Sprintf("%sin.id.%s%s.m.batch.t.%s",
		k.config.KafkaTopicPrefix, event.WorkspaceId, OtlpDestinationIdSuffix, exportTableName)
	if err := k.config.Produce(exportTopic, event.WorkspaceId, payload); err != nil {
		// a record that never left the process must not be billed
		logging.Errorf("[kafka-export] failed to enqueue export for %s/%s: %v", event.WorkspaceId, event.ActorId, err)
		return
	}

	k.produceBillingRecord(&envelope, timestamp)
}

// adaptOwnedBody adapts a bulker-owned record body for observability
// backends: `status` is renamed to `record_status` (Datadog's agentless OTLP
// intake merges top-level body keys into root log attributes, where `status`
// is reserved for severity — COMPLETED/FAILED values made every record render
// as `critical`), and a short human-readable `message` is synthesized when
// absent or empty so log list views show a line instead of a blank. Returns
// nil (caller keeps the original body) when the body can't be re-parsed
func adaptOwnedBody(bodyJSON []byte, eventType string) types.Json {
	obj := types.NewJson(0)
	if err := jsonorder.Unmarshal(bodyJSON, &obj); err != nil || obj == nil {
		return nil
	}
	if v, ok := obj.Get("status"); ok {
		obj.Delete("status")
		obj.Set("record_status", v)
	}
	if v, ok := obj.Get("message"); !ok || v == "" || v == nil {
		obj.Set("message", stateMessage(eventType, obj))
	}
	return obj
}

// stateMessage: e.g. "bulker_batch COMPLETED: 2 rows → events39"
func stateMessage(eventType string, body types.Json) string {
	var b strings.Builder
	b.WriteString(eventType)
	if s := body.GetS("record_status"); s != "" {
		b.WriteString(" " + s)
	}
	if v, ok := body.Get("processedRows"); ok {
		if n, isNum := asInt64(v); isNum {
			fmt.Fprintf(&b, ": %d rows", n)
		}
	}
	if rep, ok := body.Get("representation"); ok {
		if repObj, isObj := rep.(types.Json); isObj {
			if name := repObj.GetS("name"); name != "" {
				b.WriteString(" → " + name)
			}
		}
	}
	if e := body.GetS("error"); e != "" {
		if r := []rune(e); len(r) > 140 {
			e = string(r[:140]) + "…"
		}
		b.WriteString(" — " + e)
	}
	return b.String()
}

func asInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	case float64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	}
	return 0, false
}

// produceBillingRecord emits one active_incoming record per exported envelope.
// The composed key {eventId}_0_{secondsWithinHour} with an hour-truncated
// timestamp follows ingest's buildSyncMetrics; dedup happens downstream via
// uniqState(messageId) in ClickHouse, so retries of the same envelope cannot
// double-count
func (k *KafkaEventsLogService) produceBillingRecord(envelope *ExportEnvelope, timestamp time.Time) {
	// empty MetricsDestinationId means billing/metrics emission is disabled for
	// this deployment (same convention as ingest) — export still happens
	if k.config.MetricsDestinationId == "" {
		return
	}
	hourTrunc := timestamp.UTC().Truncate(time.Hour)
	secondsWithinHour := timestamp.Unix() - hourTrunc.Unix()
	key := fmt.Sprintf("%s_%d_%d", envelope.EventId, 0, secondsWithinHour)
	record := ActiveIncomingRecord{
		Timestamp:   hourTrunc.Format("2006-01-02T15:04:05.000Z"),
		WorkspaceId: envelope.WorkspaceId,
		MessageId:   key,
	}
	payload, err := jsonorder.Marshal(&record)
	if err != nil {
		return
	}
	billingTopic := fmt.Sprintf("%sin.id.%s.m.batch.t.active_incoming",
		k.config.KafkaTopicPrefix, k.config.MetricsDestinationId)
	if err := k.config.Produce(billingTopic, key, payload); err != nil {
		logging.Errorf("[kafka-export] failed to enqueue billing record for %s: %v", envelope.WorkspaceId, err)
	}
}

func (k *KafkaEventsLogService) PostEvent(event *ActorEvent) (id EventsLogRecordId, err error) {
	k.PostAsync(event)
	return "", nil
}

func (k *KafkaEventsLogService) GetEvents(_ EventType, _ string, _ string, _ *EventsLogFilter, _ int) ([]EventsLogRecord, error) {
	return nil, nil
}

func (k *KafkaEventsLogService) InsertTaskLog(_, _, _, _, _ string, _ time.Time) error {
	return nil
}

func (k *KafkaEventsLogService) Close() error {
	return nil
}
