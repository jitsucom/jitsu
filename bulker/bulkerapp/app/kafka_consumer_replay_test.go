package app

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConsumerRuntimeReplaysUncommittedBatchAfterRebalance(t *testing.T) {
	for _, strategy := range []string{"cooperative-sticky", "roundrobin"} {
		t.Run(strategy, func(t *testing.T) {
			testConsumerRuntimeReplayAfterRebalance(t, strategy)
		})
	}
}

func testConsumerRuntimeReplayAfterRebalance(t *testing.T, strategy string) {
	t.Helper()
	partitionCount := 1
	if strategy == "roundrobin" {
		// Two partitions guarantee each member receives one after the eager
		// rebalance, regardless of the broker-generated member ID ordering.
		partitionCount = 2
	}
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	topic := "proof-topic"
	require.NoError(t, cluster.CreateTopic(topic, partitionCount, 1))
	cfg := kafka.ConfigMap{"bootstrap.servers": cluster.BootstrapServers(), "group.id": "proof-group", "auto.offset.reset": "earliest", "enable.auto.commit": false, "partition.assignment.strategy": strategy, "session.timeout.ms": 6000}
	noop := func(string, ...any) {}
	runtime := newConsumerRuntime(cfg, topic, consumerRuntimeHooks{debugf: noop, infof: noop, errorf: noop, onKafkaError: func(kafka.Error) {}}, time.Minute)
	defer runtime.close()
	_, err = runtime.init()
	require.NoError(t, err)
	assigned, epoch, err := runtime.assignment(15 * time.Second)
	require.NoError(t, err)
	require.Len(t, assigned, partitionCount)
	producer, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": cluster.BootstrapServers()})
	require.NoError(t, err)
	defer producer.Close()
	produce := func(partition int32, value string) {
		delivery := make(chan kafka.Event, 1)
		require.NoError(t, producer.Produce(&kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: partition}, Value: []byte(value)}, delivery))
		select {
		case e := <-delivery:
			require.NoError(t, e.(*kafka.Message).TopicPartition.Error)
		case <-time.After(10 * time.Second):
			t.Fatal("produce timeout")
		}
	}
	for partition := 0; partition < partitionCount; partition++ {
		produce(int32(partition), "aborted")
	}
	consumed := make(map[int32]bool, partitionCount)
	for range partitionCount {
		msg, readErr := runtime.readMessage(5*time.Second, epoch)
		require.NoError(t, readErr)
		require.Equal(t, kafka.Offset(0), msg.TopicPartition.Offset)
		consumed[msg.TopicPartition.Partition] = true
	}
	require.Len(t, consumed, partitionCount)
	second, err := kafka.NewConsumer(&cfg)
	require.NoError(t, err)
	require.NoError(t, second.SubscribeTopics([]string{topic}, nil))
	stop := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		for {
			select {
			case <-stop:
				return
			default:
				second.Poll(100)
			}
		}
	}()
	defer func() { close(stop); <-stopped; second.Close() }()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		_, err = runtime.readMessage(100*time.Millisecond, epoch)
		if errors.Is(err, errConsumerAssignmentChanged) {
			break
		}
		if !isKafkaTimeout(err) {
			require.NoError(t, err)
		}
	}
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	assigned, newEpoch, err := runtime.assignment(15 * time.Second)
	require.NoError(t, err)
	require.Len(t, assigned, 1)
	require.Greater(t, newEpoch, epoch)
	t.Logf("%s rebalance assigned partition %d at epoch %d -> %d", strategy, assigned[0].Partition, epoch, newEpoch)
	produce(assigned[0].Partition, "next batch")
	msg, err := runtime.readMessage(5*time.Second, newEpoch)
	require.NoError(t, err)
	require.Equal(t, assigned[0].Partition, msg.TopicPartition.Partition)
	require.Equal(t, kafka.Offset(0), msg.TopicPartition.Offset)
	_, err = runtime.commitMessage(msg, epoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	_, err = runtime.commitMessage(msg, newEpoch)
	require.NoError(t, err)
	offsets, err := runtime.committed(assigned, 5000, newEpoch)
	require.NoError(t, err)
	require.Equal(t, kafka.Offset(1), offsets[0].Offset)
	t.Log("Replayed aborted offset 0 before committing offset 1")
}

type rewindTestConsumer struct {
	*fakeGroupConsumer
	committedOffset       kafka.Offset
	committedErr          error
	committedPartitionErr error
	seekErr               error
	partitionErr          error
	sought                []kafka.TopicPartition
}

func (consumer *rewindTestConsumer) Committed(partitions []kafka.TopicPartition, _ int) ([]kafka.TopicPartition, error) {
	if consumer.committedErr != nil {
		return nil, consumer.committedErr
	}
	result := append([]kafka.TopicPartition(nil), partitions...)
	for i := range result {
		result[i].Offset = consumer.committedOffset
		result[i].Error = consumer.committedPartitionErr
	}
	return result, nil
}

func (consumer *rewindTestConsumer) SeekPartitions(partitions []kafka.TopicPartition) ([]kafka.TopicPartition, error) {
	consumer.sought = append([]kafka.TopicPartition(nil), partitions...)
	if len(partitions) > 0 {
		partitions[0].Error = consumer.partitionErr
	}
	return partitions, consumer.seekErr
}

func TestConsumerRuntimeRewindsRetainedPartitions(t *testing.T) {
	for _, rebalance := range []string{"empty-assignment", "partial-revoke", "additional-assignment"} {
		for _, committed := range []kafka.Offset{kafka.OffsetInvalid, 7} {
			t.Run(fmt.Sprintf("%s/committed=%d", rebalance, committed), func(t *testing.T) {
				consumer := &rewindTestConsumer{fakeGroupConsumer: newFakeGroupConsumer(), committedOffset: committed}
				consumer.protocol = "COOPERATIVE"
				runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
				defer runtime.close()
				_, err := runtime.init()
				require.NoError(t, err)
				epoch := assignRuntime(t, runtime, consumer.fakeGroupConsumer)
				topic := "topic"
				// Pending records and a partially consumed batch must both replay.
				require.NoError(t, runtime.execute(func(session *consumerSession) {
					session.pending = append(session.pending, &kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0, Offset: 42}})
					if rebalance == "partial-revoke" {
						assert.NoError(t, consumer.IncrementalAssign([]kafka.TopicPartition{{Topic: &topic, Partition: 1}}))
					}
				}))
				require.NoError(t, runtime.pause())
				if rebalance == "partial-revoke" {
					consumer.events <- kafka.RevokedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 1}}}
				} else if rebalance == "additional-assignment" {
					consumer.events <- kafka.AssignedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 1}}}
				} else {
					consumer.events <- kafka.AssignedPartitions{}
				}
				require.NoError(t, runtime.execute(func(session *consumerSession) { session.maintain() }))
				// Synchronize with the owner before inspecting the seek and pending queue.
				require.NoError(t, runtime.execute(func(session *consumerSession) {
					assert.Empty(t, session.pending)
					if !assert.Len(t, consumer.sought, 1) {
						return
					}
					assert.Equal(t, int32(0), consumer.sought[0].Partition)
					expected := committed
					if expected == kafka.OffsetInvalid {
						expected = kafka.OffsetBeginning
					}
					assert.Equal(t, expected, consumer.sought[0].Offset)
				}))
				_, err = runtime.commitMessage(&kafka.Message{}, epoch)
				require.ErrorIs(t, err, errConsumerAssignmentChanged)
			})
		}
	}
}

func TestConsumerRuntimeRecreatesAfterRewindFailure(t *testing.T) {
	failure := errors.New("rewind failed")
	for _, stage := range []string{"committed", "committed-partition", "seek", "partition"} {
		t.Run(stage, func(t *testing.T) {
			consumer := &rewindTestConsumer{fakeGroupConsumer: newFakeGroupConsumer()}
			consumer.protocol = "COOPERATIVE"
			switch stage {
			case "committed":
				consumer.committedErr = failure
			case "committed-partition":
				consumer.committedPartitionErr = failure
			case "seek":
				consumer.seekErr = failure
			case "partition":
				consumer.partitionErr = failure
			}
			replacement := newFakeGroupConsumer()
			calls := 0
			runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
				calls++
				if calls == 1 {
					return consumer, nil
				}
				return replacement, nil
			})
			defer runtime.close()
			_, err := runtime.init()
			require.NoError(t, err)
			epoch := assignRuntime(t, runtime, consumer.fakeGroupConsumer)
			consumer.events <- kafka.AssignedPartitions{}
			_, err = runtime.readMessage(time.Second, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			require.Equal(t, int64(1), consumer.closeCount.Load())
			require.NoError(t, runtime.execute(func(session *consumerSession) {
				assert.Same(t, replacement, session.consumer)
			}))
			_, err = runtime.commitMessage(&kafka.Message{}, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
		})
	}
}
