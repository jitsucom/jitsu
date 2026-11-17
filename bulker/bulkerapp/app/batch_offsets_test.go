package app

import (
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/require"
	"io"
	"testing"
	"time"
)

func testOffsets(values ...int64) partitionOffsets {
	topic := "topic"
	result := partitionOffsets{}
	for id, v := range values {
		p := kafka.TopicPartition{Topic: &topic, Partition: int32(id), Offset: kafka.Offset(v)}
		result[partitionKey(p)] = p
	}
	return result
}
func TestBatchWindowInterleavedPartitions(t *testing.T) {
	c := newFakeGroupConsumer()
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return c, nil })
	defer runtime.close()
	_, err := runtime.init()
	require.NoError(t, err)
	c.events <- kafka.AssignedPartitions{Partitions: testOffsets(100, 7).slice()}
	_, epoch, err := runtime.assignment(time.Second)
	require.NoError(t, err)
	w := newBatchWindow(testOffsets(100, 7), testOffsets(102, 8))
	require.EqualValues(t, 3, w.remaining())
	require.NoError(t, w.resume(runtime, epoch))
	topic := "topic"
	for _, p := range []kafka.TopicPartition{{Topic: &topic, Partition: 0, Offset: 100}, {Topic: &topic, Partition: 0, Offset: 101}, {Topic: &topic, Partition: 0, Offset: 102}, {Topic: &topic, Partition: 1, Offset: 7}} {
		c.events <- &kafka.Message{TopicPartition: p}
	}
	for _, offset := range []kafka.Offset{100, 101, 7} {
		msg, err := w.read(runtime, time.Second, epoch)
		require.NoError(t, err)
		require.Equal(t, offset, msg.TopicPartition.Offset)
	}
	_, err = w.read(runtime, time.Second, epoch)
	require.ErrorIs(t, err, io.EOF)
	require.Equal(t, testOffsets(102, 8), w.next)
}

type partialCommitConsumer struct {
	*fakeGroupConsumer
	result []kafka.TopicPartition
}

func (c *partialCommitConsumer) CommitOffsets([]kafka.TopicPartition) ([]kafka.TopicPartition, error) {
	return c.result, nil
}
func TestConsumerRuntimeCommitOffsetsChecksEveryPartition(t *testing.T) {
	for _, missing := range []bool{false, true} {
		c := &partialCommitConsumer{fakeGroupConsumer: newFakeGroupConsumer(), result: testOffsets(12, 34).slice()}
		if missing {
			c.result = c.result[:1]
		} else {
			c.result[1].Error = kafka.NewError(kafka.ErrRequestTimedOut, "partition commit failed", false)
		}
		runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return c, nil })
		_, err := runtime.init()
		require.NoError(t, err)
		epoch := assignRuntime(t, runtime, c.fakeGroupConsumer)
		_, err = runtime.commitOffsets(testOffsets(12, 34).slice(), epoch)
		require.Error(t, err)
		_, err = runtime.commitOffsets(testOffsets(12, 34).slice(), epoch+1)
		require.ErrorIs(t, err, errConsumerAssignmentChanged)
		require.NoError(t, runtime.close())
	}
}

type snapshotConsumer struct {
	*fakeGroupConsumer
	checkpoints  partitionOffsets
	watermarkErr error
}

func (c *snapshotConsumer) Committed(_ []kafka.TopicPartition, _ int) ([]kafka.TopicPartition, error) {
	return c.checkpoints.slice(), nil
}
func (c *snapshotConsumer) QueryWatermarkOffsets(_ string, p int32, _ int) (int64, int64, error) {
	return int64(p) * 10, int64(p)*10 + 5, c.watermarkErr
}

func TestBatchSnapshotResetsInvalidOffsetsAndRejectsPartialResults(t *testing.T) {
	c := &snapshotConsumer{fakeGroupConsumer: newFakeGroupConsumer(), checkpoints: testOffsets(-1001, 3, 99, 32)}
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return c, nil })
	defer runtime.close()
	_, err := runtime.init()
	require.NoError(t, err)
	c.events <- kafka.AssignedPartitions{Partitions: testOffsets(0, 0, 0, 0).slice()}
	assigned, epoch, err := runtime.assignment(time.Second)
	require.NoError(t, err)
	bc := &AbstractBatchConsumer{consumer: runtime}
	starts, ends, err := bc.snapshotOffsets(assigned, epoch)
	require.NoError(t, err)
	require.Equal(t, testOffsets(0, 10, 20, 32), starts)
	require.Equal(t, testOffsets(5, 15, 25, 35), ends)
	require.NoError(t, runtime.execute(func(*consumerSession) { c.checkpoints = testOffsets(0) }))
	_, _, err = bc.snapshotOffsets(assigned, epoch)
	require.Error(t, err)
	require.NoError(t, runtime.execute(func(*consumerSession) {
		c.checkpoints = testOffsets(0, 10, 20, 30)
		c.watermarkErr = kafka.NewError(kafka.ErrRequestTimedOut, "watermark failed", false)
	}))
	_, _, err = bc.snapshotOffsets(assigned, epoch)
	require.Error(t, err)
}

type assignmentMetadataConsumer struct {
	*fakeGroupConsumer
	metadata *kafka.Metadata
	err      error
}

func (c *assignmentMetadataConsumer) GetMetadata(*string, bool, int) (*kafka.Metadata, error) {
	return c.metadata, c.err
}

func TestBatchWriterRejectsIncompleteOrFailedMetadata(t *testing.T) {
	c := &assignmentMetadataConsumer{fakeGroupConsumer: newFakeGroupConsumer(), metadata: &kafka.Metadata{Topics: map[string]kafka.TopicMetadata{"topic": {Topic: "topic", Partitions: []kafka.PartitionMetadata{{ID: 0}, {ID: 1}}}}}}
	runtime := newTestConsumerRuntime(func(*kafka.ConfigMap) (groupConsumer, error) { return c, nil })
	defer runtime.close()
	_, err := runtime.init()
	require.NoError(t, err)
	c.events <- kafka.AssignedPartitions{Partitions: testOffsets(0, 0).slice()}
	assigned, epoch, err := runtime.assignment(time.Second)
	require.NoError(t, err)
	bc := &BatchConsumerImpl{AbstractBatchConsumer: &AbstractBatchConsumer{AbstractConsumer: &AbstractConsumer{topicId: "topic"}, consumer: runtime}}
	require.NoError(t, bc.requireWholeTopicAssignment(assigned, epoch))
	require.Error(t, bc.requireWholeTopicAssignment(assigned[:1], epoch))
	require.ErrorIs(t, bc.requireWholeTopicAssignment(assigned, epoch+1), errConsumerAssignmentChanged)
	require.NoError(t, runtime.execute(func(*consumerSession) {
		c.err = kafka.NewError(kafka.ErrRequestTimedOut, "metadata unavailable", false)
	}))
	require.Error(t, bc.requireWholeTopicAssignment(assigned, epoch))
	require.NoError(t, runtime.execute(func(*consumerSession) { c.err = nil; c.metadata = &kafka.Metadata{} }))
	require.Error(t, bc.requireWholeTopicAssignment(assigned, epoch))
}
