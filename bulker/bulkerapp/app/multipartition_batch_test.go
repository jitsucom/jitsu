package app

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/stretchr/testify/require"
)

type recordingBulker struct {
	bulker.Bulker
	completed      [][]string
	beforeComplete func()
	completeErr    error
}

func (b *recordingBulker) CreateStream(string, string, bulker.BulkMode, ...bulker.StreamOption) (bulker.BulkerStream, error) {
	return &recordingBatch{owner: b}, nil
}

type recordingBatch struct {
	bulker.BulkerStream
	owner *recordingBulker
	rows  []string
}

func (s *recordingBatch) ConsumeJSON(_ context.Context, value []byte) (bulker.State, types.Object, error) {
	s.rows = append(s.rows, string(value))
	return bulker.State{}, nil, nil
}
func (s *recordingBatch) Complete(context.Context) (bulker.State, error) {
	if s.owner.beforeComplete != nil {
		s.owner.beforeComplete()
	}
	if s.owner.completeErr != nil {
		return bulker.State{}, s.owner.completeErr
	}
	s.owner.completed = append(s.owner.completed, s.rows)
	return bulker.State{ProcessedRows: len(s.rows)}, nil
}
func (s *recordingBatch) Abort(context.Context) bulker.State { return bulker.State{} }

func TestBatchConsumerCommitsMultiplePartitionsAfterDestination(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	topic := "in.id.test.m.batch.t.backup"
	require.NoError(t, cluster.CreateTopic(topic, 3, 1))
	cfg := kafka.ConfigMap{"bootstrap.servers": cluster.BootstrapServers(), "group.id": topic, "auto.offset.reset": "earliest", "enable.auto.commit": false, "session.timeout.ms": 6000}
	producer, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": cluster.BootstrapServers()})
	require.NoError(t, err)
	defer producer.Close()
	for p := int32(0); p < 2; p++ {
		for i := 0; i < 2; i++ {
			delivery := make(chan kafka.Event, 1)
			require.NoError(t, producer.Produce(&kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: p}, Value: []byte(fmt.Sprintf(`{"partition":%d,"row":%d}`, p, i))}, delivery))
			select {
			case ev := <-delivery:
				require.NoError(t, ev.(*kafka.Message).TopicPartition.Error)
			case <-time.After(10 * time.Second):
				t.Fatal("produce timeout")
			}
		}
	}
	noop := func(string, ...any) {}
	runtime := newConsumerRuntime(cfg, topic, consumerRuntimeHooks{debugf: noop, infof: noop, errorf: noop, onKafkaError: func(kafka.Error) {}}, time.Minute)
	defer runtime.close()
	config := &Config{}
	config.KafkaSessionTimeoutMs = 15000
	repository := &Repository{}
	repository.repository.Store(&repositoryInternal{destinations: map[string]*Destination{}})
	base := &AbstractBatchConsumer{AbstractConsumer: NewAbstractConsumer(config, repository, topic, nil, nil), repository: repository, consumer: runtime, mode: "batch", waitForMessages: 5 * time.Second, closed: make(chan struct{})}
	bc := &BatchConsumerImpl{AbstractBatchConsumer: base, eventsLogService: &eventslog.DummyEventsLogService{}}
	_, err = runtime.init()
	require.NoError(t, err)
	assigned, epoch, err := runtime.assignment(15 * time.Second)
	require.NoError(t, err)
	require.Len(t, assigned, 3)
	starts, ends, err := bc.snapshotOffsets(assigned, epoch)
	require.NoError(t, err)
	_, err = runtime.seekPartitions(starts.slice(), epoch)
	require.NoError(t, err)
	window := newBatchWindow(starts, ends)
	require.EqualValues(t, 4, window.remaining())
	sink := &recordingBulker{}
	dst := &Destination{config: &DestinationConfig{}, bulker: sink, streamOptions: &bulker.StreamOptions{}}
	sink.beforeComplete = func() {
		offsets, err := runtime.committed(assigned, 5000, epoch)
		require.NoError(t, err)
		for _, p := range offsets {
			require.Equal(t, kafka.OffsetInvalid, p.Offset, "no offsets before first destination completion")
		}
	}
	require.NoError(t, window.resume(runtime, epoch))
	counters, _, next, err := bc.processBatchImpl(dst, 1, 3, 0, 1, window, epoch)
	require.NoError(t, err)
	require.Equal(t, 3, counters.processed)
	require.True(t, next)
	committed, err := runtime.committed(assigned, 5000, epoch)
	require.NoError(t, err)
	var total int64
	for _, p := range committed {
		if p.Partition == 2 {
			require.Equal(t, kafka.OffsetInvalid, p.Offset, "idle partition is not committed")
		} else {
			total += int64(p.Offset)
		}
	}
	require.EqualValues(t, 3, total)
	sink.beforeComplete = nil
	require.NoError(t, window.resume(runtime, epoch))
	counters, _, next, err = bc.processBatchImpl(dst, 2, 3, 0, 1, window, epoch)
	require.NoError(t, err)
	require.Equal(t, 1, counters.processed)
	require.False(t, next)
	committed, err = runtime.committed(assigned, 5000, epoch)
	require.NoError(t, err)
	for _, p := range committed {
		if p.Partition < 2 {
			require.Equal(t, kafka.Offset(2), p.Offset)
		}
	}
	require.Len(t, sink.completed, 2)
}
