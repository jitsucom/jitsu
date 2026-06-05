package app

import (
	"context"
	"fmt"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
	"strconv"
	"strings"
	"time"
)

type RetryConsumer struct {
	*AbstractBatchConsumer
}

func NewRetryConsumer(repository *Repository, destinationId string, batchPeriodSec int, topicId string, config *Config, kafkaConfig *kafka.ConfigMap, bulkerProducer *Producer, topicManager *TopicManager) (*RetryConsumer, error) {
	base, err := NewAbstractBatchConsumer(repository, destinationId, batchPeriodSec, topicId, "retry", config, kafkaConfig, bulkerProducer, topicManager)
	if err != nil {
		return nil, err
	}
	rc := RetryConsumer{
		AbstractBatchConsumer: base,
	}
	rc.batchFunc = rc.processBatchImpl
	rc.batchSizeFunc = rc.batchSizes
	rc.shouldConsumeFunc = rc.shouldConsumeFuncImpl
	return &rc, nil
}

func (rc *RetryConsumer) shouldConsumeFuncImpl(partitionId int32, committedOffset, highOffset int64) bool {
	var firstPosition *kafka.TopicPartition
	defer func() {
		//recover
		if r := recover(); r != nil {
			rc.SystemErrorf("Recovered from panic: %v", r)
		}
		if firstPosition != nil {
			_, err := rc.consumer.Load().SeekPartitions([]kafka.TopicPartition{*firstPosition})
			if err != nil {
				rc.SystemErrorf("Failed to seek to first position: %v", err)
				//rc.restartConsumer()
			}
		}
	}()
	currentOffset := committedOffset
	for currentOffset < highOffset {
		message, err := rc.consumer.Load().ReadMessage(rc.waitForMessages)
		if err != nil {
			kafkaErr := err.(kafka.Error)
			if kafkaErr.Code() == kafka.ErrTimedOut {
				rc.Debugf("Timeout. No messages to retry. %d-%d", committedOffset, highOffset)
				return false
			}
			rc.Infof("Failed to check shouldConsume. %d-%d. Error: %v", committedOffset, highOffset, err)
			// we don't handle errors here. allow consuming to handle error properly
			return true
		}
		if firstPosition == nil {
			firstPosition = &message.TopicPartition
		}
		if message.TopicPartition.Partition != partitionId {
			rc.Debugf("Message partition %d is not equal to consumer partition %d. Skipping", message.TopicPartition.Partition, partitionId)
			// we are not interested in messages from other partitions
			return false
		}
		currentOffset = int64(message.TopicPartition.Offset)
		if rc.isTimeToRetry(message) {
			rc.Debugf("Found message to retry: %d of %d-%d", currentOffset, committedOffset, highOffset)
			//at least one message is ready to retry. we should consume
			return true
		}

	}
	rc.Debugf("No messages to retry. %d-%d", committedOffset, highOffset)
	return false
}

func (rc *RetryConsumer) batchSizes(_ *bulker.StreamOptions) (_, _, retryBatchSize int) {
	return rc.config.BatchRunnerDefaultBatchSize, 0, rc.config.RetryConsumerBatchSize

}

func (rc *RetryConsumer) processBatchImpl(_ *Destination, _, _, _, retryBatchSize int, highOffset int64, updatedHighOffset int) (counters BatchCounters, state bulker.State, nextBatch bool, err error) {
	counters.firstOffset = int64(kafka.OffsetBeginning)

	var firstPosition *kafka.TopicPartition
	var lastPosition *kafka.TopicPartition

	txOpened := false
	var producer *kafka.Producer

	defer func() {
		//recover
		if r := recover(); r != nil {
			err = rc.NewError("Recovered from panic: %v", r)
			rc.SystemErrorf("Recovered from panic: %v", r)
		}
		if err != nil {
			counters.notReadyReadded = 0
			counters.retryScheduled = 0
			//cleanup
			if firstPosition != nil {
				_, err2 := rc.consumer.Load().SeekPartitions([]kafka.TopicPartition{*firstPosition})
				if err2 != nil {
					rc.SystemErrorf("Failed to seek to first position: %v", err2)
					//rc.restartConsumer()
				}
			}
			if txOpened {
				_ = producer.AbortTransaction(context.Background())
			}
			nextBatch = false
		}
		if producer != nil {
			producer.Close()
		}
	}()

	nextBatch = true
	for i := 0; i < retryBatchSize; i++ {
		if rc.retired.Load() {
			return
		}
		if lastPosition != nil && int64(lastPosition.Offset) >= highOffset-1 {
			nextBatch = false
			rc.Debugf("Reached watermark offset %d. Stopping batch", highOffset-1)
			// we reached the end of the topic
			break
		}
		message, err := rc.consumer.Load().ReadMessage(rc.waitForMessages)
		if err != nil {
			kafkaErr := err.(kafka.Error)
			if kafkaErr.Code() == kafka.ErrTimedOut {
				nextBatch = false
				// waitForMessages period is over. it's ok. considering batch as full
				break
			}
			return counters, state, false, rc.NewError("Failed to consume event from topic. Retryable: %t: %v", kafkaErr.IsRetriable(), kafkaErr)
		}
		if firstPosition != nil && message.TopicPartition.Partition != firstPosition.Partition {
			// partition assignment may change in the middle of consumption (rebalance)
			// all messages in the batch must belong to a single partition to commit their offsets atomically.
			// seek the foreign message back so it is re-read later and commit what was already consumed
			rc.Infof("Got message from partition %d while consuming partition %d. Stopping batch", message.TopicPartition.Partition, firstPosition.Partition)
			_, seekErr := rc.consumer.Load().SeekPartitions([]kafka.TopicPartition{message.TopicPartition})
			if seekErr != nil {
				rc.SystemErrorf("Failed to seek back message from partition %d: %v", message.TopicPartition.Partition, seekErr)
			}
			// end the run: highOffset of the current run belongs to another partition. next run will query correct offsets
			nextBatch = false
			break
		}
		counters.consumed++
		lastPosition = &message.TopicPartition
		if counters.consumed == 1 {
			counters.firstOffset = int64(message.TopicPartition.Offset)
			firstPosition = &message.TopicPartition
			producer, err = rc.initTransactionalProducer()
			if err != nil {
				return counters, state, false, err
			}
			err = producer.BeginTransaction()
			if err != nil {
				return counters, state, false, fmt.Errorf("failed to begin kafka transaction: %v", err)
			}
			txOpened = true
		}
		singleCount := BatchCounters{}
		originalTopic := kafkabase.GetKafkaHeader(message, originalTopicHeader)
		topic := originalTopic
		if topic == "" {
			singleCount.skipped++
			rc.Errorf("Failed to get original topic from message headers. Skipping message")
			continue
		}
		rc.Debugf("message %s header: %v", message.TopicPartition.Offset, message.Headers)
		retries, err := kafkabase.GetKafkaIntHeader(message, retriesCountHeader)
		if err != nil {
			singleCount.skipped++
			rc.Errorf("Failed to get retries count from message headers. Skipping message")
			continue
		}
		headers := message.Headers
		if !rc.isTimeToRetry(message) {
			singleCount.notReadyReadded++
			// retry time is not yet come. requeueing message
			topic = rc.topicId
		} else {
			retries++
			singleCount.retryScheduled++
		}
		originalError := kafkabase.GetKafkaHeader(message, errorHeader)
		kafkabase.PutKafkaHeader(&headers, errorHeader, utils.ShortenStringWithEllipsis(originalError, 256))
		kafkabase.PutKafkaHeader(&headers, retriesCountHeader, strconv.Itoa(retries))
		err = kafkabase.ProduceWithBackpressure(producer, &kafka.Message{
			Key:            message.Key,
			TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: kafka.PartitionAny},
			Headers:        headers,
			Value:          message.Value,
		}, rc.config.ProducerLingerMs/2, 30*time.Second)
		if err != nil {
			if strings.Contains(err.Error(), "Message size too large") {
				rc.Errorf("Message size too large: %d. Headers: %+v Skipping message", len(message.Value), headers)
				singleCount.skipped++
			} else {
				return counters, state, false, fmt.Errorf("failed to put message to producer: %v", err)
			}
		}
		counters.accumulate(singleCount)

	}
	if !txOpened {
		return
	}
	groupMetadata, err := rc.consumer.Load().GetConsumerGroupMetadata()
	if err != nil {
		return counters, state, false, fmt.Errorf("failed to get consumer group metadata: %v", err)
	}
	offset := *lastPosition
	offset.Offset++
	//set consumer offset to the next message after failure. that happens atomically with whole producer transaction
	err = producer.SendOffsetsToTransaction(context.Background(), []kafka.TopicPartition{offset}, groupMetadata)
	if err != nil {
		return counters, state, false, fmt.Errorf("failed to send consumer offset to producer transaction: %v", err)
	}
	err = producer.CommitTransaction(context.Background())
	if err != nil {
		return counters, state, false, fmt.Errorf("failed to commit kafka transaction for producer: %v", err)
	}
	return
}

func (rc *RetryConsumer) isTimeToRetry(message *kafka.Message) bool {
	retryTime, err := kafkabase.GetKafkaTimeHeader(message, retryTimeHeader)
	if err != nil {
		rc.Errorf("failed to parse retry_time: %v", err)
		return true
	}
	if retryTime.IsZero() || time.Now().After(retryTime) {
		return true
	}
	return false
}
