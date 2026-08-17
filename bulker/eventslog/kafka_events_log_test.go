package eventslog

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type producedMessage struct {
	topic   string
	key     string
	payload []byte
}

func newTestKafkaService(prefix string, enabled map[string]bool) (*KafkaEventsLogService, *[]producedMessage) {
	produced := &[]producedMessage{}
	service := NewKafkaEventsLogService(KafkaEventsLogConfig{
		KafkaTopicPrefix:     prefix,
		MetricsDestinationId: "metrics",
		OtlpEnabled:          func(workspaceId string) bool { return enabled[workspaceId] },
		Produce: func(topic string, key string, payload []byte) error {
			*produced = append(*produced, producedMessage{topic, key, payload})
			return nil
		},
	})
	return service, produced
}

func testActorEvent() *ActorEvent {
	return &ActorEvent{
		EventType:   EventTypeFunction,
		Level:       LevelError,
		ActorId:     "con1",
		WorkspaceId: "ws1",
		MessageId:   "msg1",
		Event:       map[string]any{"type": "log-error", "functionId": "udf.f1"},
		Timestamp:   time.UnixMilli(1700000000500),
	}
}

func TestKafkaEventsLogPublishesEnvelopeAndBilling(t *testing.T) {
	service, produced := newTestKafkaService("", map[string]bool{"ws1": true})
	service.PostAsync(testActorEvent())
	require.Len(t, *produced, 2)

	export := (*produced)[0]
	require.Equal(t, "in.id.ws1_otlp.m.batch.t.live_events", export.topic)
	require.Equal(t, "ws1", export.key)
	envelope := ExportEnvelope{}
	require.NoError(t, json.Unmarshal(export.payload, &envelope))
	require.Equal(t, "ws1", envelope.WorkspaceId)
	require.Equal(t, "msg1", envelope.MessageId)
	require.Equal(t, "function", envelope.Type)
	require.Equal(t, "error", envelope.Level)
	require.Equal(t, int64(1700000000500), envelope.Timestamp)
	require.Equal(t, "con1", envelope.ActorId)
	require.Equal(t, "con1", envelope.ConnectionId)
	require.Empty(t, envelope.DestinationId)
	require.Len(t, envelope.EventId, 32)

	billing := (*produced)[1]
	require.Equal(t, "in.id.metrics.m.batch.t.active_incoming", billing.topic)
	record := ActiveIncomingRecord{}
	require.NoError(t, json.Unmarshal(billing.payload, &record))
	require.Equal(t, "ws1", record.WorkspaceId)
	// hour-truncated timestamp, key = {eventId}_0_{secondsWithinHour}
	require.Equal(t, "2023-11-14T22:00:00.000Z", record.Timestamp)
	// 1700000000 = 2023-11-14T22:13:20Z → 800 seconds within the hour
	require.Equal(t, envelope.EventId+"_0_800", record.MessageId)
	require.Equal(t, record.MessageId, billing.key)
}

func TestKafkaEventsLogTopicPrefix(t *testing.T) {
	service, produced := newTestKafkaService("pfx.", map[string]bool{"ws1": true})
	service.PostAsync(testActorEvent())
	require.Len(t, *produced, 2)
	require.Equal(t, "pfx.in.id.ws1_otlp.m.batch.t.live_events", (*produced)[0].topic)
	require.Equal(t, "pfx.in.id.metrics.m.batch.t.active_incoming", (*produced)[1].topic)
}

func TestExportEventIdCrossLanguageVector(t *testing.T) {
	// pinned in services/rotor/__tests__/kafka-events-store.test.ts too;
	// a change on either side breaks billing dedup consistency
	require.Equal(t, "dde5351e0557fb1f4dd77478100c7a88", ExportEventId("a", time.UnixMilli(1000), []byte("{}")))
}

func TestKafkaEventsLogEventIdStability(t *testing.T) {
	service, produced := newTestKafkaService("", map[string]bool{"ws1": true})
	service.PostAsync(testActorEvent())
	service.PostAsync(testActorEvent())
	require.Len(t, *produced, 4)
	first := ExportEnvelope{}
	second := ExportEnvelope{}
	require.NoError(t, json.Unmarshal((*produced)[0].payload, &first))
	require.NoError(t, json.Unmarshal((*produced)[2].payload, &second))
	// same record content → same eventId → billing dedups downstream
	require.Equal(t, first.EventId, second.EventId)

	// different content → different eventId
	changed := testActorEvent()
	changed.Event = map[string]any{"type": "log-error", "functionId": "udf.f2"}
	service.PostAsync(changed)
	third := ExportEnvelope{}
	require.NoError(t, json.Unmarshal((*produced)[4].payload, &third))
	require.NotEqual(t, first.EventId, third.EventId)
}

func TestKafkaEventsLogExportableFiltering(t *testing.T) {
	service, produced := newTestKafkaService("", map[string]bool{"ws1": true})

	// incoming is never exported
	incoming := testActorEvent()
	incoming.EventType = EventTypeIncoming
	service.PostAsync(incoming)

	// empty workspaceId is not exportable
	noWorkspace := testActorEvent()
	noWorkspace.WorkspaceId = ""
	service.PostAsync(noWorkspace)

	// disabled workspace is not exported
	disabled := testActorEvent()
	disabled.WorkspaceId = "ws2"
	service.PostAsync(disabled)

	// the otlp destination's own records are excluded (self-export loop guard)
	self := testActorEvent()
	self.EventType = EventTypeBatch
	self.ActorId = "ws1_otlp"
	service.PostAsync(self)

	require.Empty(t, *produced)

	// exact match only: a customer destination that merely ends with _otlp exports
	lookalike := testActorEvent()
	lookalike.EventType = EventTypeBatch
	lookalike.ActorId = "custom_otlp"
	service.PostAsync(lookalike)
	require.Len(t, *produced, 2)
}

func TestKafkaEventsLogBatchAndStreamTypes(t *testing.T) {
	service, produced := newTestKafkaService("", map[string]bool{"ws1": true})
	batch := testActorEvent()
	batch.EventType = EventTypeBatch
	batch.ActorId = "dst1"
	batch.MessageId = ""
	service.PostAsync(batch)

	stream := testActorEvent()
	stream.EventType = EventTypeProcessed
	stream.ActorId = "dst1"
	service.PostAsync(stream)

	require.Len(t, *produced, 4)
	batchEnvelope := ExportEnvelope{}
	require.NoError(t, json.Unmarshal((*produced)[0].payload, &batchEnvelope))
	require.Equal(t, "bulker_batch", batchEnvelope.Type)
	require.Equal(t, "dst1", batchEnvelope.DestinationId)
	require.Empty(t, batchEnvelope.ConnectionId)
	require.Empty(t, batchEnvelope.MessageId)

	streamEnvelope := ExportEnvelope{}
	require.NoError(t, json.Unmarshal((*produced)[2].payload, &streamEnvelope))
	require.Equal(t, "bulker_stream", streamEnvelope.Type)
	require.Equal(t, "msg1", streamEnvelope.MessageId)
}

func TestKafkaEventsLogBillingDisabled(t *testing.T) {
	produced := &[]producedMessage{}
	service := NewKafkaEventsLogService(KafkaEventsLogConfig{
		MetricsDestinationId: "",
		OtlpEnabled:          func(string) bool { return true },
		Produce: func(topic string, key string, payload []byte) error {
			*produced = append(*produced, producedMessage{topic, key, payload})
			return nil
		},
	})
	service.PostAsync(testActorEvent())
	// export still publishes; only the billing record is skipped
	require.Len(t, *produced, 1)
	require.Equal(t, "in.id.ws1_otlp.m.batch.t.live_events", (*produced)[0].topic)
}

func TestKafkaEventsLogNoBillingOnEnqueueFailure(t *testing.T) {
	attempted := &[]string{}
	service := NewKafkaEventsLogService(KafkaEventsLogConfig{
		MetricsDestinationId: "metrics",
		OtlpEnabled:          func(string) bool { return true },
		Produce: func(topic string, key string, payload []byte) error {
			*attempted = append(*attempted, topic)
			return fmt.Errorf("queue full")
		},
	})
	service.PostAsync(testActorEvent())
	// a record that never enqueued for export must not produce a billing record
	require.Equal(t, []string{"in.id.ws1_otlp.m.batch.t.live_events"}, *attempted)
}

func TestKafkaEventsLogInMultiService(t *testing.T) {
	service, produced := newTestKafkaService("", map[string]bool{"ws1": true})
	multi := &MultiEventsLogService{Services: []EventsLogService{&DummyEventsLogService{}, service}}
	multi.PostAsync(testActorEvent())
	require.Len(t, *produced, 2)
	require.Equal(t, "dummy,kafka-export", multi.Id())
}
