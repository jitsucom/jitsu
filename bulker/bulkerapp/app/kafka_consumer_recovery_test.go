package app

import (
	"errors"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStaticConsumerAbsent(t *testing.T) {
	for _, tc := range []struct {
		name    string
		group   kafka.ConsumerGroupDescription
		allowed bool
	}{
		{"empty", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateEmpty}, true},
		{"other member", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateStable, Members: []kafka.MemberDescription{{GroupInstanceID: "other"}}}, true},
		{"owner without partitions", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateStable, Members: []kafka.MemberDescription{{GroupInstanceID: "owner"}}}, false},
		{"rebalancing", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStatePreparingRebalance}, false},
		{"completing rebalance", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateCompletingRebalance}, false},
		{"unknown", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateUnknown}, false},
		{"dead", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateDead}, false},
		{"wrong group", kafka.ConsumerGroupDescription{GroupID: "wrong", State: kafka.ConsumerGroupStateEmpty}, false},
		{"authorization", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateEmpty, Error: kafka.NewError(kafka.ErrGroupAuthorizationFailed, "denied", false)}, false},
		{"simple group", kafka.ConsumerGroupDescription{GroupID: "group", State: kafka.ConsumerGroupStateEmpty, IsSimpleConsumerGroup: true}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := staticConsumerAbsent(kafka.DescribeConsumerGroupsResult{ConsumerGroupDescriptions: []kafka.ConsumerGroupDescription{tc.group}}, "group", "owner")
			if tc.allowed {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
	require.Error(t, staticConsumerAbsent(kafka.DescribeConsumerGroupsResult{}, "group", "owner"))
}

func allowRecoveryCheck(t *testing.T, runtime *consumerRuntime) {
	t.Helper()
	require.NoError(t, runtime.execute(func(session *consumerSession) { session.recoveryCheckAt = time.Time{} }))
}

func TestConsumerRuntimeGuardedFencingRecovery(t *testing.T) {
	for _, source := range []string{"poll", "commit", "lost-membership-fence"} {
		t.Run(source, func(t *testing.T) {
			first, second := newFakeGroupConsumer(), newFakeGroupConsumer()
			cfg := kafka.ConfigMap{"group.id": "group", "group.instance.id": "owner", "enable.auto.commit": false, "auto.offset.reset": "earliest", "isolation.level": "read_committed"}
			calls, checks := 0, 0
			checkErr := errors.New("owner still present")
			runtime := newTestConsumerRuntime(func(config *kafka.ConfigMap) (groupConsumer, error) {
				calls++
				if calls == 1 {
					return first, nil
				}
				assert.NotContains(t, *config, "group.instance.id", "must never reclaim the static identity, even if the owner returns after the check")
				for _, key := range []string{"group.id", "enable.auto.commit", "auto.offset.reset", "isolation.level"} {
					assert.Equal(t, cfg[key], (*config)[key])
				}
				assert.Equal(t, int64(1), first.closeCount.Load())
				return second, nil
			})
			// Give the constructor the config so that its private copy is exercised.
			runtime = newConsumerRuntimeWithFactory(cfg, "topic", runtime.hooks, runtime.factory, time.Hour)
			runtime.hooks.checkRecovery = func(groupID, instanceID string) error {
				checks++
				assert.Equal(t, "group", groupID)
				assert.Equal(t, "owner", instanceID)
				return checkErr
			}
			t.Cleanup(func() { require.NoError(t, runtime.close()) })
			_, err := runtime.init()
			require.NoError(t, err)
			epoch := assignRuntime(t, runtime, first)
			fenced := kafka.NewError(kafka.ErrFencedInstanceID, "fenced", true)
			switch source {
			case "commit":
				first.commitErr = fenced
				_, err = runtime.commitMessage(&kafka.Message{}, epoch)
			case "lost-membership-fence":
				first.assignmentLost = true
				first.closeErr = kafka.NewError(kafka.ErrFatal, "static consumer fenced", true)
				first.events <- kafka.RevokedPartitions{}
				_, err = runtime.readMessage(time.Second, epoch)
				require.ErrorIs(t, err, errConsumerAssignmentChanged)
				assert.Zero(t, first.closeCount.Load(), "loss alone must not replace the consumer")
				first.events <- fenced
				_, currentEpoch, assignmentErr := runtime.assignment(0)
				require.NoError(t, assignmentErr)
				_, err = runtime.readMessage(time.Second, currentEpoch)
			default:
				first.events <- fenced
				_, err = runtime.readMessage(time.Second, epoch)
			}
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Zero(t, first.unsubscribeCount.Load())
			_, err = runtime.init()
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Zero(t, checks, "initial cooldown")
			allowRecoveryCheck(t, runtime)
			for range 3 {
				_, err = runtime.init()
				require.ErrorIs(t, err, errConsumerAssignmentChanged)
			}
			assert.Equal(t, 1, checks, "owner checks must be rate limited")
			assert.Equal(t, 1, calls)
			checkErr = errors.New("broker timeout")
			allowRecoveryCheck(t, runtime)
			_, err = runtime.init()
			require.ErrorContains(t, err, "broker timeout")
			assert.Equal(t, 1, calls, "unknown ownership must fail closed")
			checkErr = nil
			allowRecoveryCheck(t, runtime)
			require.NoError(t, runtime.execute(func(session *consumerSession) { session.maintain() }))
			called := false
			require.ErrorIs(t, runtime.restart(func() { called = true }), errConsumerAssignmentChanged)
			assert.False(t, called)
			assert.Equal(t, 2, checks, "maintenance and offset repair must not recover")
			created, err := runtime.init()
			require.NoError(t, err)
			require.True(t, created)
			assert.Equal(t, "owner", cfg["group.instance.id"], "caller's config must remain unchanged")
			newEpoch := assignRuntime(t, runtime, second)
			require.Greater(t, newEpoch, epoch)
			_, err = runtime.commitMessage(&kafka.Message{}, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			_, err = runtime.seekPartitions(nil, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			_, err = runtime.groupMetadata(epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			_, err = runtime.readMessage(time.Millisecond, epoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			second.events <- fenced
			_, err = runtime.readMessage(time.Second, newEpoch)
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			allowRecoveryCheck(t, runtime)
			_, err = runtime.init()
			require.ErrorIs(t, err, errConsumerAssignmentChanged)
			assert.Equal(t, 3, checks, "no further checks or identity rotation after a second fence")
			assert.Equal(t, 2, calls)
		})
	}
}

func TestConsumerRuntimeRecoveryOpenFailure(t *testing.T) {
	for _, failure := range []string{"transient", "fatal", "subscribe-fatal", "subscribe-close-fatal"} {
		t.Run(failure, func(t *testing.T) {
			calls := 0
			first, second := newFakeGroupConsumer(), newFakeGroupConsumer()
			fatal := kafka.NewError(kafka.ErrFatal, "fatal", true)
			runtime := newTestConsumerRuntime(func(config *kafka.ConfigMap) (groupConsumer, error) {
				calls++
				if calls == 1 {
					return first, nil
				}
				require.NotContains(t, *config, "group.instance.id")
				if calls == 2 {
					switch failure {
					case "transient":
						return nil, errors.New("connection failed")
					case "fatal":
						return nil, fatal
					case "subscribe-fatal":
						second.subscribeErr = fatal
					case "subscribe-close-fatal":
						second.subscribeErr = errors.New("subscribe failed")
						second.closeErr = fatal
					}
				}
				return second, nil
			})
			runtime.maintenanceInterval = time.Hour
			runtime.config["group.id"] = "group"
			runtime.config["group.instance.id"] = "owner"
			runtime.hooks.checkRecovery = func(string, string) error { return nil }
			t.Cleanup(func() { require.NoError(t, runtime.close()) })
			_, err := runtime.init()
			require.NoError(t, err)
			require.NoError(t, runtime.execute(func(session *consumerSession) { session.checkFencing(fatal) }))
			allowRecoveryCheck(t, runtime)
			_, err = runtime.init()
			require.Error(t, err)
			if failure == "transient" {
				require.NoError(t, runtime.execute(func(session *consumerSession) {
					session.maintain()
					assert.Equal(t, 2, calls, "failed open must back off")
					session.reconnectAt = time.Time{}
					session.maintain()
				}))
				assert.Equal(t, 3, calls)
				require.NoError(t, runtime.restart(nil))
				assert.Equal(t, 4, calls, "later restarts must also stay dynamic")
			} else {
				allowRecoveryCheck(t, runtime)
				_, err = runtime.init()
				require.ErrorIs(t, err, errConsumerAssignmentChanged)
				assert.Equal(t, 2, calls, "fatal creation errors must not loop")
			}
		})
	}
}
