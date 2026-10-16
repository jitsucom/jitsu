package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/require"
)

func TestConsumerRuntimeStaticRestart(t *testing.T) {
	for _, strategy := range []string{"cooperative-sticky", "roundrobin"} {
		t.Run(strategy, func(t *testing.T) {
			servers, topic := staticMembershipTestTopic(t)
			var err error
			cfg := kafka.ConfigMap{"bootstrap.servers": servers, "group.id": topic, "group.instance.id": "bulker-0", "auto.offset.reset": "earliest", "enable.auto.commit": false, "partition.assignment.strategy": strategy, "session.timeout.ms": 10000}
			noop := func(string, ...any) {}
			runtime := newConsumerRuntime(cfg, topic, consumerRuntimeHooks{debugf: noop, infof: noop, errorf: noop, onKafkaError: func(kafka.Error) {}}, time.Minute)
			defer runtime.close()
			_, err = runtime.init()
			require.NoError(t, err)
			assigned, epoch, err := runtime.assignment(15 * time.Second)
			require.NoError(t, err)
			require.Len(t, assigned, 1)
			producer, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": servers})
			require.NoError(t, err)
			defer producer.Close()
			delivery := make(chan kafka.Event, 1)
			require.NoError(t, producer.Produce(&kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0}, Value: []byte("uncommitted")}, delivery))
			select {
			case event := <-delivery:
				require.NoError(t, event.(*kafka.Message).TopicPartition.Error)
			case <-time.After(5 * time.Second):
				t.Fatal("produce timeout")
			}
			message, err := runtime.readMessage(5*time.Second, epoch)
			require.NoError(t, err)
			require.Equal(t, kafka.Offset(0), message.TopicPartition.Offset)
			require.NoError(t, runtime.restart(nil))
			assigned, newEpoch, err := runtime.assignment(15 * time.Second)
			require.NoError(t, err)
			require.Len(t, assigned, 1)
			require.Greater(t, newEpoch, epoch)
			_, err = runtime.commitMessage(message, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			replay, err := runtime.readMessage(5*time.Second, newEpoch)
			require.NoError(t, err)
			require.Equal(t, message.TopicPartition.Offset, replay.TopicPartition.Offset)
			_, err = runtime.commitMessage(replay, newEpoch)
			require.NoError(t, err)
			offsets, err := runtime.committed(assigned, 5000, newEpoch)
			require.NoError(t, err)
			require.Equal(t, kafka.Offset(1), offsets[0].Offset)
		})
	}
}

func TestConsumerRuntimeDuplicateStaticIdentity(t *testing.T) {
	for _, strategy := range []string{"cooperative-sticky", "roundrobin"} {
		t.Run(strategy, func(t *testing.T) { testConsumerRuntimeDuplicateStaticIdentity(t, strategy) })
	}
}

func testConsumerRuntimeDuplicateStaticIdentity(t *testing.T, strategy string) {
	t.Helper()
	servers, topic := staticMembershipTestTopic(t)
	var err error
	cfg := kafka.ConfigMap{"bootstrap.servers": servers, "group.id": topic, "group.instance.id": "bulker-0", "enable.auto.commit": false, "session.timeout.ms": 6000, "heartbeat.interval.ms": 500, "partition.assignment.strategy": strategy}
	var calls atomic.Int64
	noop := func(string, ...any) {}
	runtime := newConsumerRuntimeWithFactory(cfg, topic, consumerRuntimeHooks{debugf: noop, infof: noop, errorf: noop, onKafkaError: func(kafka.Error) {}}, func(config *kafka.ConfigMap) (groupConsumer, error) {
		calls.Add(1)
		return kafka.NewConsumer(config)
	}, time.Hour)
	defer runtime.close()
	_, err = runtime.init()
	require.NoError(t, err)
	assigned, epoch, err := runtime.assignment(15 * time.Second)
	require.NoError(t, err)
	require.Len(t, assigned, 1)
	replacement, err := kafka.NewConsumer(&cfg)
	require.NoError(t, err)
	defer replacement.Close()
	require.NoError(t, replacement.SubscribeTopics([]string{topic}, nil))
	deadline := time.Now().Add(15 * time.Second)
	var stopped error
	for time.Now().Before(deadline) {
		replacement.Poll(100)
		_, stopped = runtime.readMessage(100*time.Millisecond, epoch)
		var kafkaErr kafka.Error
		if errors.As(stopped, &kafkaErr) && kafkaErr.Code() == kafka.ErrFencedInstanceID {
			break
		}
		if errors.Is(stopped, errConsumerAssignmentChanged) {
			_, epoch, err = runtime.assignment(time.Second)
			require.NoError(t, err)
			continue
		}
		if !isKafkaTimeout(stopped) {
			require.NoError(t, stopped)
		}
	}
	require.ErrorIs(t, stopped, errConsumerAssignmentChanged)
	var kafkaErr kafka.Error
	require.ErrorAs(t, stopped, &kafkaErr)
	require.Equal(t, kafka.ErrFencedInstanceID, kafkaErr.Code())
	_, err = runtime.init()
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	require.Equal(t, int64(1), calls.Load())
}

// MockCluster does not implement classic static-member replacement/fencing.
// Run against an isolated Kafka broker with BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS.
func staticMembershipTestTopic(t *testing.T) (servers, topic string) {
	t.Helper()
	servers = os.Getenv("BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS")
	if servers == "" {
		t.Skip("set BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS to run static membership integration tests")
	}
	topic = fmt.Sprintf("bulker-static-test-%d", time.Now().UnixNano())
	admin, err := kafka.NewAdminClient(&kafka.ConfigMap{"bootstrap.servers": servers})
	require.NoError(t, err)
	t.Cleanup(admin.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	results, err := admin.CreateTopics(ctx, []kafka.TopicSpecification{{Topic: topic, NumPartitions: 1, ReplicationFactor: 1}})
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Equal(t, kafka.ErrNoError, results[0].Error.Code())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := admin.DeleteTopics(ctx, []string{topic})
		require.NoError(t, err)
	})
	return
}
