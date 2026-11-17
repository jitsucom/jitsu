package app

import (
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

type topicPartitionKey struct {
	topic     string
	partition int32
}
type partitionOffsets map[topicPartitionKey]kafka.TopicPartition

func partitionKey(p kafka.TopicPartition) topicPartitionKey {
	topic := ""
	if p.Topic != nil {
		topic = *p.Topic
	}
	return topicPartitionKey{topic, p.Partition}
}
func offsetsFrom(partitions []kafka.TopicPartition) partitionOffsets {
	offsets := make(partitionOffsets, len(partitions))
	for _, p := range partitions {
		offsets[partitionKey(p)] = p
	}
	return offsets
}
func (o partitionOffsets) clone() partitionOffsets { return offsetsFrom(o.slice()) }
func (o partitionOffsets) slice() []kafka.TopicPartition {
	result := make([]kafka.TopicPartition, 0, len(o))
	for _, p := range o {
		result = append(result, p)
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := partitionKey(result[i]), partitionKey(result[j])
		if a.topic != b.topic {
			return a.topic < b.topic
		}
		return a.partition < b.partition
	})
	return result
}
func (o partitionOffsets) observe(p kafka.TopicPartition) {
	p.Offset++
	p.Error = nil
	o[partitionKey(p)] = p
}
func (o partitionOffsets) first(p kafka.TopicPartition) {
	key := partitionKey(p)
	if _, ok := o[key]; !ok {
		p.Error = nil
		o[key] = p
	}
}
func (o partitionOffsets) merge(next partitionOffsets) {
	for k, p := range next {
		o[k] = p
	}
}

// batchWindow snapshots each assigned partition's end independently. Offsets
// from different partitions are never compared or committed as a single number.
// next is the read position, not a durable checkpoint.
type batchWindow struct{ next, end partitionOffsets }

func newBatchWindow(start, end partitionOffsets) *batchWindow {
	return &batchWindow{next: start.clone(), end: end.clone()}
}
func (w *batchWindow) remaining() int64 {
	var count int64
	for k, end := range w.end {
		count += max(int64(end.Offset-w.next[k].Offset), 0)
	}
	return count
}
func (w *batchWindow) resume(c *consumerRuntime, epoch uint64) error {
	active := make(partitionOffsets)
	for k, end := range w.end {
		if w.next[k].Offset < end.Offset {
			active[k] = end
		}
	}
	return c.selectPartitions(active.slice(), epoch)
}
func (w *batchWindow) read(c *consumerRuntime, timeout time.Duration, epoch uint64) (*kafka.Message, error) {
	deadline := time.Now().Add(timeout)
	for w.remaining() > 0 {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, kafka.NewError(kafka.ErrTimedOut, "batch window timed out", false)
		}
		message, err := c.readMessage(remaining, epoch)
		if err != nil {
			return nil, err
		}
		key := partitionKey(message.TopicPartition)
		end, ok := w.end[key]
		if !ok || message.TopicPartition.Offset >= end.Offset {
			// A partition outside this batch (or past its snapshot) must be replayed
			// later. Pause it so a hot partition cannot starve the remaining ones.
			if _, err = c.seekPartitions([]kafka.TopicPartition{message.TopicPartition}, epoch); err != nil {
				return nil, err
			}
			if err = c.pausePartitions([]kafka.TopicPartition{message.TopicPartition}, epoch); err != nil {
				return nil, err
			}
			if ok {
				w.next[key] = end
			}
			continue
		}
		w.next.observe(message.TopicPartition)
		return message, nil
	}
	return nil, io.EOF
}

func partitionResults(requested, result []kafka.TopicPartition) error {
	expected := offsetsFrom(requested)
	for _, p := range result {
		if p.Error != nil {
			return fmt.Errorf("partition %v: %w", p, p.Error)
		}
		delete(expected, partitionKey(p))
	}
	if len(expected) > 0 {
		return fmt.Errorf("Kafka omitted partition results: %v", expected.slice())
	}
	return nil
}
