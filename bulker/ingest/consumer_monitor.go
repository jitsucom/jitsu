package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/mroth/weightedrand/v2"
)

type ConsumerMonitor struct {
	sync.RWMutex
	appbase.Service
	adminClient              *kafka.AdminClient
	topic, consumerGroupName string
	threshold                int64
	weightedRandom           *weightedrand.Chooser[int32, int64]
	cancel                   context.CancelFunc
	done                     chan struct{}
}

func NewConsumerMonitor(appContext *Context, topic, consumerGroupName string) (*ConsumerMonitor, error) {
	adminClient, err := appContext.producer.NewAdminClient()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	tm := &ConsumerMonitor{
		Service:           appbase.NewServiceBase("topic-monitor"),
		adminClient:       adminClient,
		topic:             topic,
		consumerGroupName: consumerGroupName,
		threshold:         appContext.config.WeightedPartitionSelectorLagThreshold,
		cancel:            cancel,
		done:              make(chan struct{}),
	}
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				close(tm.done)
				return
			case <-ticker.C:
				poll, cancelPoll := context.WithTimeout(ctx, 5*time.Second)
				chooser, err := tm.partitionWeights(poll)
				cancelPoll()
				if err != nil && ctx.Err() == nil {
					tm.Errorf("Error refreshing partition weights for %s: %v", tm.topic, err)
				}
				tm.Lock()
				if (tm.weightedRandom == nil) != (chooser == nil) {
					tm.Debugf("Weighted partition selection for %s enabled: %t", tm.topic, chooser != nil)
				}
				tm.weightedRandom = chooser
				tm.Unlock()
			}
		}
	})
	return tm, nil
}

func (tm *ConsumerMonitor) partitionWeights(ctx context.Context) (*weightedrand.Chooser[int32, int64], error) {
	// A producer metadata request may auto-create a missing topic with broker
	// defaults. Topic provisioning and retention belong to the topic manager.
	metadata, err := tm.adminClient.DescribeTopics(ctx, kafka.NewTopicCollectionOfTopicNames([]string{tm.topic}))
	if err != nil {
		return nil, err
	}
	if len(metadata.TopicDescriptions) != 1 || metadata.TopicDescriptions[0].Name != tm.topic {
		return nil, fmt.Errorf("missing metadata for %s", tm.topic)
	}
	topic := metadata.TopicDescriptions[0]
	if topic.Error.Code() != kafka.ErrNoError {
		return nil, topic.Error
	}

	var partitions []kafka.TopicPartition
	latest := make(map[kafka.TopicPartition]kafka.OffsetSpec)
	for _, p := range topic.Partitions {
		if p.Leader == nil || p.Leader.ID < 0 {
			continue
		}
		tp := kafka.TopicPartition{Topic: &tm.topic, Partition: int32(p.Partition)}
		partitions = append(partitions, tp)
		latest[tp] = kafka.LatestOffsetSpec
	}
	if len(partitions) == 0 {
		return nil, nil
	}

	commits, err := tm.adminClient.ListConsumerGroupOffsets(ctx, []kafka.ConsumerGroupTopicPartitions{{Group: tm.consumerGroupName, Partitions: partitions}})
	if err != nil {
		return nil, err
	}
	ends, err := tm.adminClient.ListOffsets(ctx, latest)
	if err != nil {
		return nil, err
	}

	starts, uncommitted := committedStarts(tm.topic, commits)
	if len(uncommitted) > 0 {
		// Rotor starts at the earliest retained offset when there is no commit.
		// It can be nonzero if a group's offsets expired after log retention.
		earliest, err := tm.adminClient.ListOffsets(ctx, uncommitted)
		if err != nil {
			return nil, err
		}
		for id, offset := range validOffsets(tm.topic, earliest) {
			starts[id] = offset
		}
	}
	lags := partitionLags(starts, validOffsets(tm.topic, ends))
	var maxLag int64
	for _, lag := range lags {
		maxLag = max(maxLag, lag)
	}
	if maxLag <= tm.threshold {
		return nil, nil
	}
	choices := make([]weightedrand.Choice[int32, int64], 0, len(lags))
	for id, lag := range lags {
		choices = append(choices, weightedrand.NewChoice(id, maxLag-lag+1))
	}
	return weightedrand.NewChooser(choices...)
}

func committedStarts(topic string, commits kafka.ListConsumerGroupOffsetsResult) (map[int32]int64, map[kafka.TopicPartition]kafka.OffsetSpec) {
	missing := make(map[kafka.TopicPartition]kafka.OffsetSpec)
	offsets := make(map[int32]int64)
	for _, group := range commits.ConsumerGroupsTopicPartitions {
		for _, p := range group.Partitions {
			if p.Topic == nil || *p.Topic != topic || p.Error != nil {
				continue
			}
			switch {
			case p.Offset >= 0:
				offsets[p.Partition] = int64(p.Offset)
			case p.Offset == kafka.OffsetInvalid:
				missing[kafka.TopicPartition{Topic: p.Topic, Partition: p.Partition}] = kafka.EarliestOffsetSpec
			}
		}
	}
	return offsets, missing
}

func validOffsets(topic string, result kafka.ListOffsetsResult) map[int32]int64 {
	offsets := make(map[int32]int64)
	for p, info := range result.ResultInfos {
		if p.Topic != nil && *p.Topic == topic && info.Error.Code() == kafka.ErrNoError && info.Offset >= 0 {
			offsets[p.Partition] = int64(info.Offset)
		}
	}
	return offsets
}

func partitionLags(starts, ends map[int32]int64) map[int32]int64 {
	lags := make(map[int32]int64)
	for id, end := range ends {
		if start, ok := starts[id]; ok {
			lags[id] = max(0, end-start)
		}
	}
	return lags
}

func (tm *ConsumerMonitor) SelectPartition() int32 {
	tm.RLock()
	defer tm.RUnlock()
	if tm.weightedRandom == nil {
		return kafka.PartitionAny
	}
	return tm.weightedRandom.Pick()
}

func (tm *ConsumerMonitor) Close() {
	tm.cancel()
	<-tm.done
	tm.adminClient.Close()
}
