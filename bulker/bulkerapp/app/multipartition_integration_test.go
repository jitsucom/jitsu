package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	basetypes "github.com/jitsucom/bulker/jitsubase/types"
	"github.com/stretchr/testify/require"
)

// Uses the same real Kafka fixture as the existing retry integration tests:
// MockCluster cannot prove transactional offset commits or partition expansion.
func TestMultipartitionTransactionsAndExpansion(t *testing.T) {
	sharedContainers(t)
	servers := "127.0.0.1:19092"
	cfg := &Config{RetryConsumerBatchSize: 2, MessagesRetryCount: 5}
	cfg.KafkaAdminMetadataTimeoutMs = 10000
	cfg.KafkaSessionTimeoutMs = 15000
	admin, err := kafka.NewAdminClient(&kafka.ConfigMap{"bootstrap.servers": servers})
	require.NoError(t, err)
	defer admin.Close()
	tm := &TopicManager{Service: appbase.NewServiceBase("multipartition-test"), config: cfg, kaftaAdminClient: admin, allTopics: basetypes.NewSet[string](), ready: true}
	var topics []string
	defer func() {
		if len(topics) > 0 {
			_, _ = admin.DeleteTopics(context.Background(), topics)
		}
	}()
	create := func(t *testing.T, mode string, partitions int) string {
		topic := fmt.Sprintf("in.id.multi-%d.m.%s.t.backup", time.Now().UnixNano(), mode)
		results, e := admin.CreateTopics(context.Background(), []kafka.TopicSpecification{{Topic: topic, NumPartitions: partitions, ReplicationFactor: 1}})
		require.NoError(t, e)
		require.NoError(t, validatePartitionExpansion(topic, results))
		topics = append(topics, topic)
		tm.allTopics.Put(topic)
		return topic
	}
	producer, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": servers})
	require.NoError(t, err)
	defer producer.Close()
	produce := func(t *testing.T, topic string, partition int32, value string, headers []kafka.Header) {
		delivery := make(chan kafka.Event, 1)
		require.NoError(t, producer.Produce(&kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: partition}, Key: []byte(value), Value: []byte(value), Headers: headers}, delivery))
		select {
		case ev := <-delivery:
			require.NoError(t, ev.(*kafka.Message).TopicPartition.Error)
		case <-time.After(10 * time.Second):
			t.Fatal("produce timeout")
		}
	}
	newBase := func(t *testing.T, topic, mode string) *AbstractBatchConsumer {
		config := kafka.ConfigMap{"bootstrap.servers": servers, "group.id": topic, "auto.offset.reset": "earliest", "enable.auto.commit": false, "session.timeout.ms": 6000, "isolation.level": "read_committed", "topic.metadata.refresh.interval.ms": 500}
		noop := func(string, ...any) {}
		runtime := newConsumerRuntime(config, topic, consumerRuntimeHooks{debugf: noop, infof: noop, errorf: noop, onKafkaError: func(kafka.Error) {}}, time.Minute)
		t.Cleanup(func() { require.NoError(t, runtime.close()) })
		repo := &Repository{}
		repo.repository.Store(&repositoryInternal{destinations: map[string]*Destination{}})
		base := &AbstractBatchConsumer{AbstractConsumer: NewAbstractConsumer(cfg, repo, topic, nil, tm), repository: repo, consumer: runtime, mode: mode, waitForMessages: 2 * time.Second, closed: make(chan struct{}), producerConfig: kafka.ConfigMap{"bootstrap.servers": servers, "transactional.id": topic + "-test", "transaction.timeout.ms": 10000, "message.timeout.ms": 10000}}
		_, e := runtime.init()
		require.NoError(t, e)
		return base
	}
	snapshot := func(t *testing.T, base *AbstractBatchConsumer) (*batchWindow, []kafka.TopicPartition, uint64) {
		assigned, epoch, e := base.consumer.assignment(15 * time.Second)
		require.NoError(t, e)
		starts, ends, e := base.snapshotOffsets(assigned, epoch)
		require.NoError(t, e)
		_, e = base.consumer.seekPartitions(starts.slice(), epoch)
		require.NoError(t, e)
		w := newBatchWindow(starts, ends)
		require.NoError(t, w.resume(base.consumer, epoch))
		return w, assigned, epoch
	}
	readValues := func(t *testing.T, topic string, count int) []string {
		c, e := kafka.NewConsumer(&kafka.ConfigMap{"bootstrap.servers": servers, "group.id": topic + "-observer", "auto.offset.reset": "earliest", "enable.auto.commit": false, "isolation.level": "read_committed"})
		require.NoError(t, e)
		defer c.Close()
		require.NoError(t, c.SubscribeTopics([]string{topic}, nil))
		var values []string
		for range count {
			m, e := c.ReadMessage(15 * time.Second)
			require.NoError(t, e)
			values = append(values, string(m.Value))
		}
		return values
	}
	t.Run("failed_batch_transaction", func(t *testing.T) {
		topic, retry := create(t, "batch", 3), create(t, "retry", 3)
		for p := int32(0); p < 2; p++ {
			for i := 0; i < 2; i++ {
				produce(t, topic, p, fmt.Sprintf(`{"p":%d,"i":%d}`, p, i), nil)
			}
		}
		base := newBase(t, topic, "batch")
		bc := &BatchConsumerImpl{AbstractBatchConsumer: base, retryTopic: retry, eventsLogService: &eventslog.DummyEventsLogService{}}
		w, assigned, epoch := snapshot(t, base)
		sink := &recordingBulker{completeErr: errors.New("destination unavailable")}
		dst := &Destination{config: &DestinationConfig{}, bulker: sink, streamOptions: &bulker.StreamOptions{}}
		counts, _, _, e := bc.processBatchImpl(dst, 1, 10, 0, 2, w, epoch)
		require.ErrorContains(t, e, "destination unavailable")
		require.Equal(t, 4, counts.retryScheduled)
		committed, e := base.consumer.committed(assigned, 5000, epoch)
		require.NoError(t, e)
		for _, p := range committed {
			if p.Partition < 2 {
				require.Equal(t, kafka.Offset(2), p.Offset)
			} else {
				require.Equal(t, kafka.OffsetInvalid, p.Offset)
			}
		}
		require.ElementsMatch(t, []string{`{"p":0,"i":0}`, `{"p":0,"i":1}`, `{"p":1,"i":0}`, `{"p":1,"i":1}`}, readValues(t, retry, 4))
	})
	t.Run("retry_publication_failure_replays_all_partitions", func(t *testing.T) {
		topic, retry := create(t, "batch", 2), create(t, "retry", 2)
		values := []string{`{"small":true}`, `{"large":"` + strings.Repeat("x", 4096) + `"}`}
		for p, value := range values {
			produce(t, topic, int32(p), value, nil)
		}
		base := newBase(t, topic, "batch")
		bc := &BatchConsumerImpl{AbstractBatchConsumer: base, retryTopic: retry}
		w, assigned, epoch := snapshot(t, base)
		// Force Produce to reject the large record after the transaction opens.
		base.producerConfig["message.max.bytes"] = 1000
		_, e := bc.processFailed(w.next, w.end, errors.New("destination unavailable"), epoch)
		require.Error(t, e)
		committed, e := base.consumer.committed(assigned, 5000, epoch)
		require.NoError(t, e)
		for _, p := range committed {
			require.Equal(t, kafka.OffsetInvalid, p.Offset)
		}
		// A successful retry must publish each record exactly once to a
		// read_committed observer, including any record in the aborted transaction.
		delete(base.producerConfig, "message.max.bytes")
		counts, e := bc.processFailed(w.next, w.end, errors.New("destination unavailable"), epoch)
		require.NoError(t, e)
		require.Equal(t, 2, counts.retryScheduled)
		require.ElementsMatch(t, values, readValues(t, retry, 2))
		committed, e = base.consumer.committed(assigned, 5000, epoch)
		require.NoError(t, e)
		for _, p := range committed {
			require.Equal(t, kafka.Offset(1), p.Offset)
		}
	})
	t.Run("retry_due_and_future_partitions", func(t *testing.T) {
		topic, output := create(t, "retry", 3), create(t, "batch", 1)
		for p := int32(0); p < 3; p++ {
			when := time.Now().Add(-time.Hour)
			if p == 0 {
				when = time.Now().Add(time.Hour)
			}
			produce(t, topic, p, fmt.Sprint(p), []kafka.Header{{Key: originalTopicHeader, Value: []byte(output)}, {Key: retriesCountHeader, Value: []byte("0")}, {Key: retryTimeHeader, Value: []byte(timestamp.ToISOFormat(when.UTC()))}})
		}
		base := newBase(t, topic, "retry")
		rc := &RetryConsumer{AbstractBatchConsumer: base}
		w, assigned, epoch := snapshot(t, base)
		due, e := rc.shouldConsumeFuncImpl(w, epoch)
		require.NoError(t, e)
		require.True(t, due)
		require.NoError(t, w.resume(base.consumer, epoch))
		counts, _, next, e := rc.processBatchImpl(nil, 1, 10, 0, 10, w, epoch)
		require.NoError(t, e)
		require.False(t, next)
		require.Equal(t, 2, counts.retryScheduled)
		require.Equal(t, 1, counts.notReadyReadded)
		committed, e := base.consumer.committed(assigned, 5000, epoch)
		require.NoError(t, e)
		for _, p := range committed {
			require.Equal(t, kafka.Offset(1), p.Offset)
		}
		require.ElementsMatch(t, []string{"1", "2"}, readValues(t, output, 2))
		// Only the future record remains after the first transaction. Its scan must
		// not commit it or repeatedly requeue it when no partition has a due record.
		w, _, epoch = snapshot(t, base)
		due, e = rc.shouldConsumeFuncImpl(w, epoch)
		require.NoError(t, e)
		require.False(t, due)
	})
	t.Run("expand_live_topic", func(t *testing.T) {
		topic := create(t, "batch", 1)
		produce(t, topic, 0, `{"old":true}`, nil)
		base := newBase(t, topic, "batch")
		bc := &BatchConsumerImpl{AbstractBatchConsumer: base, eventsLogService: &eventslog.DummyEventsLogService{}}
		sink := &recordingBulker{}
		dst := &Destination{config: &DestinationConfig{}, bulker: sink, streamOptions: &bulker.StreamOptions{}}
		w, _, epoch := snapshot(t, base)
		counts, _, _, e := bc.processBatchImpl(dst, 1, 10, 0, 2, w, epoch)
		require.NoError(t, e)
		require.Equal(t, 1, counts.processed)
		require.NoError(t, tm.expandBatchTopic(topic, 3))
		require.Eventually(t, func() bool {
			meta, err := producer.GetMetadata(&topic, false, 1000)
			return err == nil && len(meta.Topics[topic].Partitions) == 3
		}, 10*time.Second, 100*time.Millisecond)
		for p := int32(0); p < 3; p++ {
			produce(t, topic, p, fmt.Sprintf(`{"new":%d}`, p), nil)
		}
		require.Eventually(t, func() bool {
			assigned, _, e := base.consumer.assignment(time.Second)
			return e == nil && len(assigned) == 3
		}, 20*time.Second, 100*time.Millisecond)
		w, assigned, epoch := snapshot(t, base)
		require.EqualValues(t, 3, w.remaining())
		counts, _, _, e = bc.processBatchImpl(dst, 2, 10, 0, 2, w, epoch)
		require.NoError(t, e)
		require.Equal(t, 3, counts.processed)
		committed, e := base.consumer.committed(assigned, 5000, epoch)
		require.NoError(t, e)
		for _, p := range committed {
			expected := kafka.Offset(1)
			if p.Partition == 0 {
				expected = 2
			}
			require.Equal(t, expected, p.Offset)
		}
	})
}
