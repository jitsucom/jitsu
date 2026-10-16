package app

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeGroupConsumer struct {
	mu sync.Mutex

	events           chan kafka.Event
	assignment       []kafka.TopicPartition
	paused           bool
	closed           bool
	assignmentLost   bool
	protocol         string
	pauseErr         error
	subscribeErr     error
	rebalanceCb      kafka.RebalanceCb
	pollCount        atomic.Int64
	closeCount       atomic.Int64
	unsubscribeCount atomic.Int64
	commitErr        error
	closeErr         error
	inCallback       atomic.Bool
	closedInCb       atomic.Bool
}

func newFakeGroupConsumer() *fakeGroupConsumer {
	return &fakeGroupConsumer{events: make(chan kafka.Event, 16)}
}

func (consumer *fakeGroupConsumer) SubscribeTopics(_ []string, rebalanceCb kafka.RebalanceCb) error {
	consumer.rebalanceCb = rebalanceCb
	return consumer.subscribeErr
}

func (consumer *fakeGroupConsumer) Poll(timeoutMs int) kafka.Event {
	consumer.pollCount.Add(1)
	if timeoutMs <= 0 {
		select {
		case event := <-consumer.events:
			return consumer.deliver(event)
		default:
			return nil
		}
	}
	timer := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)
	defer timer.Stop()
	select {
	case event := <-consumer.events:
		return consumer.deliver(event)
	case <-timer.C:
		return nil
	}
}

func (consumer *fakeGroupConsumer) deliver(event kafka.Event) kafka.Event {
	if consumer.rebalanceCb != nil {
		switch event.(type) {
		case kafka.AssignedPartitions, kafka.RevokedPartitions:
			consumer.inCallback.Store(true)
			_ = consumer.rebalanceCb(nil, event)
			consumer.inCallback.Store(false)
			return nil
		}
	}
	return event
}

func (consumer *fakeGroupConsumer) Assign(partitions []kafka.TopicPartition) error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	consumer.assignment = append([]kafka.TopicPartition(nil), partitions...)
	return nil
}

func (consumer *fakeGroupConsumer) Unassign() error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	consumer.assignment = nil
	return nil
}

func (consumer *fakeGroupConsumer) IncrementalAssign(partitions []kafka.TopicPartition) error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	consumer.assignment = append(consumer.assignment, partitions...)
	return nil
}

func (consumer *fakeGroupConsumer) IncrementalUnassign(partitions []kafka.TopicPartition) error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	removed := make(map[int32]struct{}, len(partitions))
	for _, partition := range partitions {
		removed[partition.Partition] = struct{}{}
	}
	kept := consumer.assignment[:0]
	for _, partition := range consumer.assignment {
		if _, ok := removed[partition.Partition]; !ok {
			kept = append(kept, partition)
		}
	}
	consumer.assignment = kept
	return nil
}

func (consumer *fakeGroupConsumer) GetRebalanceProtocol() string {
	if consumer.protocol == "" {
		return "EAGER"
	}
	return consumer.protocol
}

func (consumer *fakeGroupConsumer) Assignment() ([]kafka.TopicPartition, error) {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	return append([]kafka.TopicPartition(nil), consumer.assignment...), nil
}

func (consumer *fakeGroupConsumer) AssignmentLost() bool { return consumer.assignmentLost }

func (consumer *fakeGroupConsumer) Pause([]kafka.TopicPartition) error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	if consumer.pauseErr != nil {
		return consumer.pauseErr
	}
	consumer.paused = true
	return nil
}

func (consumer *fakeGroupConsumer) Resume([]kafka.TopicPartition) error {
	consumer.mu.Lock()
	defer consumer.mu.Unlock()
	consumer.paused = false
	return nil
}

func (consumer *fakeGroupConsumer) QueryWatermarkOffsets(string, int32, int) (int64, int64, error) {
	return 0, 0, nil
}

func (consumer *fakeGroupConsumer) Committed(partitions []kafka.TopicPartition, _ int) ([]kafka.TopicPartition, error) {
	return partitions, nil
}

func (consumer *fakeGroupConsumer) SeekPartitions(partitions []kafka.TopicPartition) ([]kafka.TopicPartition, error) {
	return partitions, nil
}

func (consumer *fakeGroupConsumer) CommitMessage(message *kafka.Message) ([]kafka.TopicPartition, error) {
	return []kafka.TopicPartition{message.TopicPartition}, consumer.commitErr
}

func (consumer *fakeGroupConsumer) GetConsumerGroupMetadata() (*kafka.ConsumerGroupMetadata, error) {
	return nil, nil
}

func (consumer *fakeGroupConsumer) Unsubscribe() error {
	consumer.unsubscribeCount.Add(1)
	return nil
}

func (consumer *fakeGroupConsumer) Close() error {
	consumer.closeCount.Add(1)
	if consumer.inCallback.Load() {
		consumer.closedInCb.Store(true)
	}
	consumer.mu.Lock()
	consumer.closed = true
	consumer.mu.Unlock()
	return consumer.closeErr
}

func (consumer *fakeGroupConsumer) String() string { return "fake-consumer" }

func newTestConsumerRuntime(factory groupConsumerFactory) *consumerRuntime {
	noop := func(string, ...any) {}
	return newConsumerRuntimeWithFactory(kafka.ConfigMap{}, "topic", consumerRuntimeHooks{
		debugf:       noop,
		infof:        noop,
		errorf:       noop,
		onKafkaError: func(kafka.Error) {},
	}, factory, 5*time.Millisecond)
}

func TestConsumerMaintenanceInterval(t *testing.T) {
	assert.Equal(t, 10*time.Second, consumerMaintenanceInterval(5*time.Minute))
	assert.Equal(t, 5*time.Second, consumerMaintenanceInterval(20*time.Second))
	assert.Equal(t, 10*time.Second, consumerMaintenanceInterval(0))
}

func TestConsumerRuntimeInitPreservesOpenErrors(t *testing.T) {
	openErr := errors.New("consumer open failed")
	for _, stage := range []string{"create", "subscribe"} {
		t.Run(stage, func(t *testing.T) {
			consumer := newFakeGroupConsumer()
			runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
				if stage == "create" {
					return nil, openErr
				}
				consumer.subscribeErr = openErr
				return consumer, nil
			})
			t.Cleanup(func() { require.NoError(t, runtime.close()) })

			created, err := runtime.init()
			assert.True(t, created)
			require.ErrorIs(t, err, openErr)
		})
	}
}

func assignRuntime(t *testing.T, runtime *consumerRuntime, consumer *fakeGroupConsumer) uint64 {
	t.Helper()
	topic := "topic"
	consumer.events <- kafka.AssignedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 0}}}
	partitions, epoch, err := runtime.assignment(100 * time.Millisecond)
	require.NoError(t, err)
	require.Len(t, partitions, 1)
	return epoch
}

func TestConsumerRuntimePollsWhilePaused(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	created, err := runtime.init()
	require.NoError(t, err)
	require.True(t, created)
	assignRuntime(t, runtime, consumer)
	require.NoError(t, runtime.pause())
	pollsBefore := consumer.pollCount.Load()

	require.Eventually(t, func() bool {
		return consumer.pollCount.Load() > pollsBefore
	}, 100*time.Millisecond, 5*time.Millisecond)
}

func TestConsumerRuntimeRetriesFailedPauseWhilePolling(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	assignRuntime(t, runtime, consumer)
	pauseErr := errors.New("pause failed")
	consumer.mu.Lock()
	consumer.pauseErr = pauseErr
	consumer.mu.Unlock()
	pollsBefore := consumer.pollCount.Load()

	require.ErrorIs(t, runtime.pause(), pauseErr)
	require.Eventually(t, func() bool {
		return consumer.pollCount.Load() > pollsBefore
	}, 100*time.Millisecond, 5*time.Millisecond)
	consumer.mu.Lock()
	consumer.pauseErr = nil
	consumer.mu.Unlock()
	require.Eventually(t, func() bool {
		consumer.mu.Lock()
		defer consumer.mu.Unlock()
		return consumer.paused
	}, 100*time.Millisecond, 5*time.Millisecond)
}

func TestConsumerRuntimeTreatsEmptyAssignmentAsHealthy(t *testing.T) {
	consumer := newFakeGroupConsumer()
	var factoryCalls atomic.Int64
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
		factoryCalls.Add(1)
		return consumer, nil
	})
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	consumer.events <- kafka.AssignedPartitions{}
	partitions, _, err := runtime.assignment(time.Second)
	require.NoError(t, err)
	assert.Empty(t, partitions)
	assert.Equal(t, int64(1), factoryCalls.Load())
	assert.Equal(t, int64(1), consumer.pollCount.Load(), "stop waiting once an empty assignment is confirmed")
	polls := consumer.pollCount.Load()
	partitions, _, err = runtime.assignment(time.Second)
	require.NoError(t, err)
	assert.Empty(t, partitions)
	assert.Equal(t, polls, consumer.pollCount.Load(), "a healthy idle member must not wait again")
}

func TestConsumerRuntimeKeepsMessageReadWhileWaitingForAssignment(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	topic := "topic"
	consumer.events <- kafka.AssignedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 0}}}
	expected := &kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0, Offset: 42}}
	consumer.events <- expected

	partitions, epoch, err := runtime.assignment(100 * time.Millisecond)
	require.NoError(t, err)
	require.Len(t, partitions, 1)
	message, err := runtime.readMessage(20*time.Millisecond, epoch)
	require.NoError(t, err)
	assert.Same(t, expected, message)
}

func TestConsumerRuntimeRejectsOldEpochAfterRevocation(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, consumer)
	consumer.events <- kafka.RevokedPartitions{}

	_, err = runtime.readMessage(20*time.Millisecond, epoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	_, err = runtime.commitMessage(&kafka.Message{}, epoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
}

func TestConsumerRuntimeReturnsMessagePartitionError(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, consumer)
	partitionErr := kafka.NewError(kafka.ErrTimedOut, "partition fetch timed out", false)
	consumer.events <- &kafka.Message{TopicPartition: kafka.TopicPartition{Error: partitionErr}}

	message, err := runtime.readMessage(20*time.Millisecond, epoch)
	assert.Nil(t, message)
	require.Error(t, err)
	var kafkaErr kafka.Error
	require.ErrorAs(t, err, &kafkaErr)
	assert.Equal(t, kafka.ErrTimedOut, kafkaErr.Code())
}

func TestConsumerRuntimeKeepsMessageReadAfterRebalance(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	oldEpoch := assignRuntime(t, runtime, consumer)
	topic := "topic"
	partitions := []kafka.TopicPartition{{Topic: &topic, Partition: 0}}
	consumer.events <- kafka.RevokedPartitions{Partitions: partitions}
	consumer.events <- kafka.AssignedPartitions{Partitions: partitions}
	expected := &kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0, Offset: 42}}
	consumer.events <- expected

	message, err := runtime.readMessage(100*time.Millisecond, oldEpoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	assert.Nil(t, message)

	assigned, newEpoch, err := runtime.assignment(100 * time.Millisecond)
	require.NoError(t, err)
	require.Len(t, assigned, 1)
	message, err = runtime.readMessage(20*time.Millisecond, newEpoch)
	require.NoError(t, err)
	assert.Same(t, expected, message)
}

func TestConsumerRuntimeDiscardsPendingMessagesAfterSeek(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, consumer)
	topic := "topic"
	stale := &kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0, Offset: 11}}
	require.NoError(t, runtime.execute(func(session *consumerSession) {
		session.pending = append(session.pending, stale)
	}))

	_, err = runtime.seekPartitions([]kafka.TopicPartition{{Topic: &topic, Partition: 0, Offset: 10}}, epoch)
	require.NoError(t, err)
	expected := &kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: 0, Offset: 10}}
	consumer.events <- expected
	message, err := runtime.readMessage(20*time.Millisecond, epoch)
	require.NoError(t, err)
	assert.Same(t, expected, message)
}

func TestConsumerRuntimeRecreatesFatalConsumerInsideOwnerLoop(t *testing.T) {
	first := newFakeGroupConsumer()
	second := newFakeGroupConsumer()
	consumers := []groupConsumer{first, second}
	var factoryCalls atomic.Int64
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
		index := int(factoryCalls.Add(1)) - 1
		if index >= len(consumers) {
			return nil, errors.New("unexpected extra consumer creation")
		}
		return consumers[index], nil
	})
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, first)
	first.events <- kafka.NewError(kafka.ErrAllBrokersDown, "fatal consumer failure", true)

	_, err = runtime.readMessage(20*time.Millisecond, epoch)
	require.Error(t, err)
	assert.Equal(t, int64(2), factoryCalls.Load())
	assert.Equal(t, int64(1), first.closeCount.Load())
	assert.Equal(t, "fake-consumer", runtime.description())
}

func TestConsumerRuntimeKeepsReplacementPaused(t *testing.T) {
	first := newFakeGroupConsumer()
	second := newFakeGroupConsumer()
	consumers := []groupConsumer{first, second}
	var factoryCalls atomic.Int64
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
		return consumers[int(factoryCalls.Add(1))-1], nil
	})
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	assignRuntime(t, runtime, first)
	require.NoError(t, runtime.pause())
	first.events <- kafka.NewError(kafka.ErrAllBrokersDown, "fatal consumer failure", true)

	require.Eventually(t, func() bool {
		return factoryCalls.Load() == 2
	}, 100*time.Millisecond, 5*time.Millisecond)
	topic := "topic"
	second.events <- kafka.AssignedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 0}}}
	require.Eventually(t, func() bool {
		second.mu.Lock()
		defer second.mu.Unlock()
		return second.paused
	}, 100*time.Millisecond, 5*time.Millisecond)
}

func TestConsumerRuntimeRecreatesConsumerAfterAssignmentIsLost(t *testing.T) {
	first := newFakeGroupConsumer()
	first.assignmentLost = true
	second := newFakeGroupConsumer()
	consumers := []groupConsumer{first, second}
	var factoryCalls atomic.Int64
	var membershipErrors atomic.Int64
	noop := func(string, ...any) {}
	runtime := newConsumerRuntimeWithFactory(kafka.ConfigMap{}, "topic", consumerRuntimeHooks{
		debugf: noop,
		infof:  noop,
		errorf: noop,
		onKafkaError: func(err kafka.Error) {
			if err.Code() == kafka.ErrUnknownMemberID {
				membershipErrors.Add(1)
			}
		},
	}, func(*kafka.ConfigMap) (groupConsumer, error) {
		return consumers[int(factoryCalls.Add(1))-1], nil
	}, 5*time.Millisecond)
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, first)
	first.events <- kafka.RevokedPartitions{}

	_, err = runtime.readMessage(20*time.Millisecond, epoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	assert.Equal(t, int64(2), factoryCalls.Load())
	assert.Equal(t, int64(1), first.closeCount.Load())
	assert.Equal(t, int64(1), membershipErrors.Load())
	assert.False(t, first.closedInCb.Load())
}

func TestConsumerRuntimeSupportsCooperativeRebalances(t *testing.T) {
	consumer := newFakeGroupConsumer()
	consumer.protocol = "COOPERATIVE"
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })

	_, err := runtime.init()
	require.NoError(t, err)
	epoch := assignRuntime(t, runtime, consumer)
	topic := "topic"
	consumer.events <- kafka.RevokedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 0}}}

	_, err = runtime.readMessage(20*time.Millisecond, epoch)
	require.ErrorIs(t, err, errConsumerAssignmentChanged)
	partitions, _, err := runtime.assignment(0)
	require.NoError(t, err)
	assert.Empty(t, partitions)
}

func TestConsumerRuntimeClosesConsumerExactlyOnce(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })

	_, err := runtime.init()
	require.NoError(t, err)
	require.NoError(t, runtime.close())
	require.NoError(t, runtime.close())
	assert.Equal(t, int64(1), consumer.closeCount.Load())
}

func TestConsumerRuntimeAssignmentWaitTimesOut(t *testing.T) {
	consumer := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return consumer, nil })
	t.Cleanup(func() { require.NoError(t, runtime.close()) })
	_, err := runtime.init()
	require.NoError(t, err)
	partitions, _, err := runtime.assignment(10 * time.Millisecond)
	require.NoError(t, err)
	assert.Empty(t, partitions)
	assert.Positive(t, consumer.pollCount.Load())
}

func TestConsumerRuntimeStaticMemberCloseModes(t *testing.T) {
	for _, mode := range []string{"restart", "recreate", "offset-repair", "suspend", "retire"} {
		t.Run(mode, func(t *testing.T) {
			first, second := newFakeGroupConsumer(), newFakeGroupConsumer()
			var calls int
			runtime := newTestConsumerRuntime(func(config *kafka.ConfigMap) (groupConsumer, error) {
				assert.Equal(t, "bulker-0", (*config)["group.instance.id"])
				calls++
				if calls == 1 {
					return first, nil
				}
				assert.Equal(t, int64(1), first.closeCount.Load(), "old handle must close before replacement")
				return second, nil
			})
			runtime.config["group.instance.id"] = "bulker-0"
			t.Cleanup(func() { require.NoError(t, runtime.close()) })
			_, err := runtime.init()
			require.NoError(t, err)
			switch mode {
			case "restart":
				require.NoError(t, runtime.restart(nil))
			case "recreate":
				require.NoError(t, runtime.execute(func(session *consumerSession) { err = session.recreate() }))
				require.NoError(t, err)
			case "offset-repair":
				called := false
				require.NoError(t, runtime.restart(func() {
					called = true
					assert.Equal(t, int64(1), first.unsubscribeCount.Load())
					assert.Equal(t, int64(1), first.closeCount.Load())
					assert.Equal(t, 1, calls)
				}))
				require.True(t, called)
			case "suspend":
				require.NoError(t, runtime.suspend())
			case "retire":
				require.NoError(t, runtime.close())
			}
			wantUnsubscribe := int64(1)
			if mode == "restart" || mode == "recreate" {
				wantUnsubscribe = 0
			}
			assert.Equal(t, wantUnsubscribe, first.unsubscribeCount.Load())
			assert.Equal(t, int64(1), first.closeCount.Load())
		})
	}
}

func TestConsumerRuntimeFencingIsTerminal(t *testing.T) {
	for _, source := range []string{"poll", "commit", "commit-fatal", "local-fence"} {
		t.Run(source, func(t *testing.T) {
			consumer := newFakeGroupConsumer()
			var calls atomic.Int64
			runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
				calls.Add(1)
				return consumer, nil
			})
			runtime.maintenanceInterval = time.Hour
			t.Cleanup(func() { require.NoError(t, runtime.close()) })
			_, err := runtime.init()
			require.NoError(t, err)
			epoch := assignRuntime(t, runtime, consumer)
			code := kafka.ErrFencedInstanceID
			if source == "commit-fatal" {
				code = kafka.ErrFatal
			}
			if source == "local-fence" {
				code = kafka.ErrFenced
			}
			fenced := kafka.NewError(code, "duplicate static identity", true)
			if source == "commit" || source == "commit-fatal" {
				consumer.commitErr = fenced
				_, err = runtime.commitMessage(&kafka.Message{}, epoch)
			} else {
				consumer.events <- fenced
				_, err = runtime.readMessage(time.Second, epoch)
			}
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Equal(t, int64(1), consumer.closeCount.Load())
			assert.Zero(t, consumer.unsubscribeCount.Load())
			require.NoError(t, runtime.execute(func(session *consumerSession) { session.maintain() }))
			_, err = runtime.init()
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			called := false
			err = runtime.restart(func() { called = true })
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.False(t, called, "fenced member must not repair offsets")
			_, err = runtime.commitMessage(&kafka.Message{}, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Equal(t, int64(1), calls.Load(), "fenced member must not rejoin")
		})
	}
}

func TestConsumerRuntimeFencingDuringClosePreventsReplacement(t *testing.T) {
	for _, mode := range []string{"restart", "recreate", "suspend"} {
		t.Run(mode, func(t *testing.T) {
			consumer := newFakeGroupConsumer()
			var calls atomic.Int64
			runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
				calls.Add(1)
				return consumer, nil
			})
			runtime.maintenanceInterval = time.Hour
			t.Cleanup(func() { require.NoError(t, runtime.close()) })
			_, err := runtime.init()
			require.NoError(t, err)
			consumer.closeErr = kafka.NewError(kafka.ErrFencedInstanceID, "fenced during close", true)
			called := false
			if mode == "restart" {
				err = runtime.restart(func() { called = true })
			} else if mode == "suspend" {
				err = runtime.suspend()
			} else {
				require.NoError(t, runtime.execute(func(session *consumerSession) { err = session.recreate() }))
			}
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.False(t, called)
			_, err = runtime.init()
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Equal(t, int64(1), calls.Load())
		})
	}
}
