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
	metadata, err := tm.adminClient.GetMetadata(&tm.topic, false, 1000)
	if err != nil {
		return nil, err
	}
	topic, ok := metadata.Topics[tm.topic]
	if !ok {
		return nil, fmt.Errorf("missing metadata for %s", tm.topic)
	}
	if topic.Error.Code() != kafka.ErrNoError {
		return nil, topic.Error
	}

	var partitions []kafka.TopicPartition
	latest := make(map[kafka.TopicPartition]kafka.OffsetSpec)
	for _, p := range topic.Partitions {
		if p.Error.Code() != kafka.ErrNoError || p.Leader < 0 {
			continue
		}
		tp := kafka.TopicPartition{Topic: &tm.topic, Partition: p.ID}
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

	lags := partitionLags(tm.topic, commits, ends)
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

func partitionLags(topic string, commits kafka.ListConsumerGroupOffsetsResult, ends kafka.ListOffsetsResult) map[int32]int64 {
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
				// A newly created partition has no committed offset.
				offsets[p.Partition] = 0
			}
		}
	}
	lags := make(map[int32]int64)
	for p, end := range ends.ResultInfos {
		start, ok := offsets[p.Partition]
		if ok && p.Topic != nil && *p.Topic == topic && end.Error.Code() == kafka.ErrNoError && end.Offset >= 0 {
			lags[p.Partition] = max(0, int64(end.Offset)-start)
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
