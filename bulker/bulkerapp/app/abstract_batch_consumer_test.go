package app

import (
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMembershipLossReason(t *testing.T) {
	testCases := []struct {
		desc     string
		err      kafka.Error
		lost     bool
		contains string
	}{
		{"max.poll.interval exceeded", kafka.NewError(kafka.ErrMaxPollExceeded, "Application maximum poll interval (300000ms) exceeded", false), true, "max.poll.interval"},
		{"fenced static instance (broker)", kafka.NewError(kafka.ErrFencedInstanceID, "Static consumer fenced by other consumer with same group.instance.id", true), true, "fenced"},
		{"fenced (local)", kafka.NewError(kafka.ErrFenced, "fenced", true), true, "fenced"},
		{"unknown member", kafka.NewError(kafka.ErrUnknownMemberID, "Unknown member", false), true, "member"},
		{"any fatal error", kafka.NewError(kafka.ErrFatal, "fatal", true), true, "fatal"},
		{"timeout is not a membership loss", kafka.NewError(kafka.ErrTimedOut, "timed out", false), false, ""},
		{"transient broker error is not a membership loss", kafka.NewError(kafka.ErrTransport, "transport", false), false, ""},
	}
	for _, tc := range testCases {
		t.Run(tc.desc, func(t *testing.T) {
			reason := membershipLossReason(tc.err)
			assert.Equal(t, tc.lost, reason != "")
			if tc.contains != "" {
				assert.Contains(t, reason, tc.contains)
			}
		})
	}
}

// A background replacement already exists when RunJob starts, but has not yet
// received its assignment. The current job must wait and consume its backlog.
func TestBatchConsumerWaitsForBackgroundReplacementAssignment(t *testing.T) {
	first := newFakeGroupConsumer()
	second := &backloggedGroupConsumer{newFakeGroupConsumer()}
	calls := 0
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) {
		calls++
		if calls == 1 {
			return first, nil
		}
		return second, nil
	})
	// Drive maintenance explicitly so it cannot assign the replacement before RunJob.
	runtime.maintenanceInterval = time.Hour
	t.Cleanup(func() { require.NoError(t, runtime.close()) })
	_, err := runtime.init()
	require.NoError(t, err)
	assignRuntime(t, runtime, first)
	require.NoError(t, runtime.pause())
	first.events <- kafka.NewError(kafka.ErrFatal, "replace idle consumer", true)
	require.NoError(t, runtime.execute(func(session *consumerSession) { session.maintain() }))
	require.Equal(t, 2, calls)
	created, err := runtime.init()
	require.NoError(t, err)
	require.False(t, created)
	topic := "topic"
	second.events <- kafka.AssignedPartitions{Partitions: []kafka.TopicPartition{{Topic: &topic, Partition: 0}}}
	config := &Config{}
	config.KafkaSessionTimeoutMs = 100
	batchCalls := 0
	bc := &AbstractBatchConsumer{
		AbstractConsumer: NewAbstractConsumer(config, nil, topic, nil, nil),
		consumer:         runtime,
		mode:             "batch",
		batchPeriodSec:   300,
		batchSizeFunc:    func(*bulker.StreamOptions) (int, int, int) { return 1, 1, 1 },
		batchFunc: func(*Destination, int, int, int, int, int64, int, uint64) (BatchCounters, bulker.State, bool, error) {
			batchCalls++
			return BatchCounters{consumed: 1, processed: 1}, bulker.State{}, false, nil
		},
	}
	bc.RunJob()
	require.Equal(t, 1, batchCalls, "consume in this job rather than waiting another batch period")
}

type backloggedGroupConsumer struct{ *fakeGroupConsumer }

func (*backloggedGroupConsumer) QueryWatermarkOffsets(string, int32, int) (int64, int64, error) {
	return 0, 1, nil
}
