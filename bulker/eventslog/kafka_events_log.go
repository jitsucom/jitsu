package eventslog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
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

// ExportEventId derives the stable per-record id: a content hash, so export
// retries and pipeline reprocessing produce the same id and the billing flow's
// uniqState(messageId) dedup collapses them. Same recipe in rotor (TS)
func ExportEventId(actorId string, timestamp time.Time, payload []byte) string {
	h := sha256.New()
	h.Write([]byte(actorId))
	h.Write([]byte("|"))
	h.Write([]byte(fmt.Sprintf("%d", timestamp.UnixMilli())))
	h.Write([]byte("|"))
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// ExportProduceFunc produces one message to a Kafka topic. Implementations must
// be async/non-blocking — export must never delay events-log writes
type ExportProduceFunc func(topic string, key string, payload []byte)

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
	if strings.HasSuffix(event.ActorId, OtlpDestinationIdSuffix) {
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
	body, err := json.Marshal(event.Event)
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
	}
	payload, err := json.Marshal(&envelope)
	if err != nil {
		logging.Errorf("[kafka-export] failed to marshal export envelope for %s/%s: %v", event.WorkspaceId, event.ActorId, err)
		return
	}
	// topic grammar: {prefix}in.id.{destinationId}.m.batch.t.{table}
	exportTopic := fmt.Sprintf("%sin.id.%s%s.m.batch.t.%s",
		k.config.KafkaTopicPrefix, event.WorkspaceId, OtlpDestinationIdSuffix, exportTableName)
	k.config.Produce(exportTopic, event.WorkspaceId, payload)

	k.produceBillingRecord(&envelope, timestamp)
}

// produceBillingRecord emits one active_incoming record per exported envelope.
// The composed key {eventId}_0_{secondsWithinHour} with an hour-truncated
// timestamp follows ingest's buildSyncMetrics; dedup happens downstream via
// uniqState(messageId) in ClickHouse, so retries and regenerated records
// cannot double-count
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
	payload, err := json.Marshal(&record)
	if err != nil {
		return
	}
	billingTopic := fmt.Sprintf("%sin.id.%s.m.batch.t.active_incoming",
		k.config.KafkaTopicPrefix, k.config.MetricsDestinationId)
	k.config.Produce(billingTopic, key, payload)
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
