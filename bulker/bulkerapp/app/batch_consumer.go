package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
)

type BatchConsumerImpl struct {
	*AbstractBatchConsumer
	retryTopic       string
	eventsLogService eventslog.EventsLogService
}

func NewBatchConsumer(repository *Repository, destinationId string, batchPeriodSec int, topicId string, config *Config, kafkaConfig *kafka.ConfigMap, bulkerProducer *Producer, eventsLogService eventslog.EventsLogService, topicManager *TopicManager) (*BatchConsumerImpl, error) {
	base, err := NewAbstractBatchConsumer(repository, destinationId, batchPeriodSec, topicId, "batch", config, kafkaConfig, bulkerProducer, topicManager)
	if err != nil {
		return nil, err
	}
	bc := BatchConsumerImpl{
		AbstractBatchConsumer: base,
		eventsLogService:      eventsLogService,
	}
	retryTopic, _ := MakeTopicId(destinationId, retryTopicMode, allTablesToken, config.KafkaTopicPrefix, 0, false)
	bc.retryTopic = retryTopic
	bc.assignmentCheck = bc.requireWholeTopicAssignment
	bc.batchSizeFunc = bc.batchSizes
	bc.batchFunc = bc.processBatchImpl
	return &bc, nil
}

// Multiple destination writers are not safe yet (e.g. backup object names can
// collide). Keep offset handling generic, but fail closed on a split batch-topic
// assignment. Retry consumers do not write destinations and may share a group.
func (bc *BatchConsumerImpl) requireWholeTopicAssignment(assigned []kafka.TopicPartition, epoch uint64) error {
	partitions, err := bc.consumer.topicPartitions(bc.topicId, epoch)
	if err != nil {
		return err
	}
	if len(assigned) != len(partitions) {
		return fmt.Errorf("batch topic %s requires one writer owning all %d partitions; this member owns %d: ensure only one instance is active for its logical shard", bc.topicId, len(partitions), len(assigned))
	}
	if err = partitionResults(partitions, assigned); err != nil {
		return fmt.Errorf("batch topic requires the complete partition assignment: %w", err)
	}
	return nil
}

// abortedTransactionMarker is the Postgres error raised by every statement that follows
// a failed one in the same transaction: "current transaction is aborted, commands ignored
// until end of transaction block". Matched as the driver renders it - the bare code could
// show up in an error for other reasons, e.g. inside an event payload or a table name.
// The code and not the message, because Postgres localizes messages but never SQLSTATEs.
const abortedTransactionMarker = "SQLSTATE 25P02"

// isAbortedTransactionError reports whether the batch died on an aborted transaction.
// Such a failure is sticky: whatever broke the transaction is a property of the
// destination, not of the messages, so every following batch is going to fail exactly
// the same way. Grinding through the backlog only republishes the whole topic to the
// retry topic - one batch per run is enough, the next run will retry.
//
// The check is on the message and not on the error type because the SQLSTATE is only
// carried as text by the time the error gets here: errorx wraps opaquely, so the
// driver error is no longer reachable with errors.As.
func isAbortedTransactionError(err error) bool {
	return err != nil && strings.Contains(err.Error(), abortedTransactionMarker)
}

func (bc *BatchConsumerImpl) batchSizes(streamOptions *bulker.StreamOptions) (maxBatchSize, maxBatchSizeBytes, retryBatchSize int) {
	maxBatchSize = bulker.BatchSizeOption.Get(streamOptions)
	if maxBatchSize <= 0 {
		maxBatchSize = bc.config.BatchRunnerDefaultBatchSize
	}

	maxBatchSizeBytes = bulker.BatchSizeBytesOption.Get(streamOptions)

	retryBatchSize = bulker.RetryBatchSizeOption.Get(streamOptions)
	if retryBatchSize <= 0 {
		retryBatchSize = int(float64(maxBatchSize) * bc.config.BatchRunnerDefaultRetryBatchFraction)
	}
	return
}

func (bc *BatchConsumerImpl) processBatchImpl(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, window *batchWindow, consumerEpoch uint64) (counters BatchCounters, state bulker.State, nextBatch bool, err error) {
	bc.Debugf("Starting batch #%d", batchNum)
	startTime := time.Now()
	var bulkerStream bulker.BulkerStream
	ctx := context.WithValue(context.Background(), bulker.BatchNumberCtxKey, batchNum)

	//position of last message in batch in case of failed. Needed for processFailed
	failedBatch := false
	firstPositions, nextPositions := make(partitionOffsets), make(partitionOffsets)
	var latestMessage *kafka.Message
	var processedObjectSample types.Object

	defer func() {
		if counters.consumed > 0 {
			state.QueueSize = int(window.remaining())
			bc.postEventsLog(state, processedObjectSample, err)
		}
		if err != nil {
			if !failedBatch && counters.processed == 0 && len(firstPositions) > 0 {
				if _, seekErr := bc.consumer.seekPartitions(firstPositions.slice(), consumerEpoch); seekErr != nil {
					bc.restartConsumer(nil)
				}
			}
			nextBatch = false
			counters.failed = counters.consumed - counters.processed
			if counters.failed > 0 {
				// we separate original errors from retry errors
				metricsMeta := kafkabase.GetKafkaHeader(latestMessage, MetricsMetaHeader)
				bc.SendMetrics(metricsMeta, "error", counters.failed-counters.retried)
				bc.SendMetrics(metricsMeta, "retry_error", counters.retried)
			}
			if failedBatch {
				cnts, err2 := bc.processFailed(firstPositions, nextPositions, err, consumerEpoch)
				counters.deadLettered = cnts.deadLettered
				counters.retryScheduled = cnts.retryScheduled
				if err2 != nil {
					bc.errorMetric("PROCESS_FAILED_ERROR")
					bc.SystemErrorf(err2.Error())
					bc.restartConsumer(nil)
				} else if counters.failed > 1 && window.remaining() > 0 && !isAbortedTransactionError(err) {
					// if we fail right on the first message - that probably means connection problems. No need to move further.
					// otherwise we can try to consume next batch
					nextBatch = true
				}
			}
		} else if counters.processed > 0 {
			bc.SendMetrics(kafkabase.GetKafkaHeader(latestMessage, MetricsMetaHeader), "success", counters.processed)
		}
	}()
	processed := 0
	maxMessageSize := 0
	consumedBytes := 0
	for i := 0; i < batchSize; i++ {
		if bc.retired.Load() {
			if bulkerStream != nil {
				_ = bulkerStream.Abort(ctx)
			}
			return
		}
		if window.remaining() == 0 {
			nextBatch = false
			break
		}
		if batchSizeBytes > 0 && consumedBytes+maxMessageSize >= batchSizeBytes {
			nextBatch = true
			bc.Debugf("Reached batch size %d of %d. Stopping batch", consumedBytes, batchSizeBytes)
			break
		}
		message, err := window.read(bc.consumer, bc.waitForMessages, consumerEpoch)
		if err != nil {
			var kafkaErr kafka.Error
			if errors.Is(err, io.EOF) || errors.As(err, &kafkaErr) && kafkaErr.Code() == kafka.ErrTimedOut {
				// waitForMessages period is over. it's ok. considering batch as full
				break
			}
			if bulkerStream != nil {
				_ = bulkerStream.Abort(ctx)
			}
			return counters, state, false, bc.NewError("Failed to consume event from topic: %v", err)
		}
		messageSize := len(message.Value)
		maxMessageSize = max(maxMessageSize, messageSize)
		consumedBytes += messageSize

		counters.consumed++
		retriesHeader := kafkabase.GetKafkaHeader(message, retriesCountHeader)
		if retriesHeader != "" {
			// we perform retries in smaller batches
			//batchSize = retryBatchSize
			counters.retried++
		}
		latestMessage = message
		firstPositions.first(message.TopicPartition)
		nextPositions.observe(message.TopicPartition)
		if bulkerStream == nil {
			destination.InitBulkerInstance()
			streamOptions := destination.streamOptions.Options
			opts, err1 := kafkabase.GetKafkaObjectHeader(message, streamOptionsKeyHeader)
			if err1 != nil {
				bc.errorMetric("parse options error")
				bc.Errorf("%v", err1)
			}
			if len(opts) > 0 {
				streamOptions = make([]bulker.StreamOption, 0, len(streamOptions)+2)
				streamOptions = append(streamOptions, destination.streamOptions.Options...)
				for name, serializedOption := range opts {
					opt, err2 := bulker.ParseOption(name, serializedOption)
					if err2 != nil {
						bc.Errorf("Failed to parse stream option: %s=%s: %v", name, serializedOption, err2)
						bc.errorMetric("parse options error")
						continue
					}
					streamOptions = append(streamOptions, opt)
				}
			}
			bulkerStream, err = destination.bulker.CreateStream(bc.topicId, bc.tableName, bulker.Batch, streamOptions...)
			if err != nil {
				bc.errorMetric("failed to create bulker stream")
				err = bc.NewError("Failed to create bulker stream: %v", err)
			}
		}
		if err == nil {
			//bc.Debugf("%d. Consumed Message ID: %s Offset: %s (Retries: %s) for: %s", i, obj.Id(), message.TopicPartition.Offset.String(), kafkabase.GetKafkaHeader(message, retriesCountHeader), destination.config.BulkerType)
			_, processedObjectSample, err = bulkerStream.ConsumeJSON(ctx, message.Value)
			if err != nil {
				bc.errorMetric("bulker_stream_error")
			}
		}
		if err != nil {
			failedBatch = true
			state = bulker.State{}
			if bulkerStream != nil {
				state = bulkerStream.Abort(ctx)
			}
			//treat failed message as processed
			state.ProcessedRows++
			state.ProcessingTimeSec = time.Since(startTime).Seconds()
			return counters, state, false, bc.NewError("Failed to process event to bulker stream: %v", err)
		} else {
			processed++
		}
	}
	//we've processed some messages. it is time to commit them
	if processed > 0 {
		if processed == batchSize {
			nextBatch = true
		}
		//No more records are needed while the destination commits. Pause now so
		//the owner runtime can keep polling group events throughout a slow load.
		bc.pause(true)

		bc.Debugf("Batch #%d Committing %d events to %s", batchNum, processed, destination.config.BulkerType)
		//TODO: do we need to interrupt commit if consumer is retired?
		state, err = bulkerStream.Complete(ctx)
		state.ProcessedBytes = consumedBytes
		state.ProcessingTimeSec = time.Since(startTime).Seconds()
		if err != nil {
			var batchErr *types.BatchError
			if errors.As(err, &batchErr) && batchErr.SuccessCount > 0 {
				extraState := bulker.State{
					Status:        bulker.Failed,
					Mode:          bulker.Batch,
					ProcessedRows: len(batchErr.Errors),
				}
				extraState.SetError(err)
				extraState.Representation = map[string]any{
					"name":     destination.config.BulkerType,
					"status":   batchErr.Code,
					"response": batchErr.FullError(),
				}
				bc.SendMetrics(kafkabase.GetKafkaHeader(latestMessage, MetricsMetaHeader), "error", len(batchErr.Errors))
				bc.postEventsLog(extraState, nil, err)
				err = nil
				processed = batchErr.SuccessCount
				state.Status = bulker.Completed
				state.LastErrorText = ""
				state.LastError = nil
				state.ProcessedRows = processed
				state.SuccessfulRows = processed
				state.Representation = map[string]any{
					"name":     destination.config.BulkerType,
					"status":   batchErr.Code,
					"response": fmt.Sprintf("%s:\nA detailed error breakdown can be found in the adjacent log entry.", batchErr.Error()),
				}
			} else {
				failedBatch = true
				return counters, state, false, bc.NewError("Failed to commit bulker stream to %s: %v", destination.config.BulkerType, err)
			}
		}
		counters.processed = processed
		counters.processedBytes = consumedBytes
		_, err = bc.consumer.commitOffsets(nextPositions.slice(), consumerEpoch)
		if err != nil {
			bc.errorMetric("KAFKA_COMMIT_ERR:" + metrics.KafkaErrorCode(err))
			// The destination may have completed even when Kafka acknowledged only
			// some offsets. Replay from committed offsets; never overwrite a newer
			// owner's checkpoints with an unfenced admin offset repair.
			bc.restartConsumer(nil)
			return counters, state, false, fmt.Errorf("commit batch offsets after destination completion: %w", err)
		}

	} else if bulkerStream != nil {
		_ = bulkerStream.Abort(ctx)
	}
	return
}

// processFailed consumes the latest failed batch of messages and sends them to the 'failed' topic
func (bc *BatchConsumerImpl) processFailed(firstPositions, endPositions partitionOffsets, originalErr error, consumerEpoch uint64) (counters BatchCounters, err error) {
	var producer *kafka.Producer
	committedPositions := firstPositions.clone()
	window := newBatchWindow(firstPositions, endPositions)

	retryBatchSize := bc.config.RetryConsumerBatchSize
	defer func() {
		//recover
		if r := recover(); r != nil {
			err = bc.NewError("Recovered from panic: %v", r)
			bc.SystemErrorf("Recovered from panic: %v", r)
		}
		if producer != nil {
			_ = producer.AbortTransaction(context.Background())
			producer.Close()
		}
		if err != nil {
			err = bc.NewError("Failed to put unsuccessful batch to 'failed' producer: %v", err)
			//cleanup
			_, err2 := bc.consumer.seekPartitions(committedPositions.slice(), consumerEpoch)
			if err2 != nil {
				bc.errorMetric("SEEK_ERROR")
			}
		}

	}()
	err = bc.topicManager.ensureTopic(bc.retryTopic, 1, bc.topicManager.RetryTopicConfig())
	if err != nil {
		return counters, fmt.Errorf("failed to create retry topic %s: %v", bc.retryTopic, err)
	}

	producer, err = bc.initTransactionalProducer()
	if err != nil {
		return
	}

	bc.Infof("Replaying failed batch ranges %v -> %v", firstPositions.slice(), endPositions.slice())
	if _, err = bc.consumer.seekPartitions(firstPositions.slice(), consumerEpoch); err != nil {
		return counters, err
	}
	if err = window.resume(bc.consumer, consumerEpoch); err != nil {
		return counters, err
	}

	var groupMetadata *kafka.ConsumerGroupMetadata
	groupMetadata, err = bc.consumer.groupMetadata(consumerEpoch)
	if err != nil {
		err = fmt.Errorf("failed to get consumer group metadata: %v", err)
		return
	}

	var message *kafka.Message
	for window.remaining() > 0 {
		transactionOffsets := make(partitionOffsets)
		err = producer.BeginTransaction()
		if err != nil {
			return BatchCounters{}, fmt.Errorf("failed to begin kafka transaction: %v", err)
		}

		for i := 0; i < retryBatchSize; i++ {
			message, err = window.read(bc.consumer, bc.waitForMessages, consumerEpoch)
			if err != nil {
				var kafkaErr kafka.Error
				if errors.As(err, &kafkaErr) && kafkaErr.Code() == kafka.ErrTimedOut {
					err = fmt.Errorf("failed to consume message: %v", err)
					return
				}
				if errors.As(err, &kafkaErr) && kafkaErr.IsRetriable() {
					time.Sleep(10 * time.Second)
					continue
				} else {
					err = fmt.Errorf("failed to consume message: %v", err)
					return
				}
			}
			transactionOffsets.observe(message.TopicPartition)
			counters.consumed++
			deadLettered := false
			failedTopic := bc.retryTopic
			retries, err := kafkabase.GetKafkaIntHeader(message, retriesCountHeader)
			if err != nil {
				bc.Errorf("failed to read retry header: %v", err)
			}
			if retries >= bc.config.MessagesRetryCount {
				//no attempts left - send to dead-letter topic
				deadLettered = true
				failedTopic = bc.config.KafkaDestinationsDeadLetterTopicName
			}
			headers := message.Headers
			kafkabase.PutKafkaHeader(&headers, errorHeader, utils.ShortenStringWithEllipsis(originalErr.Error(), 256))
			kafkabase.PutKafkaHeader(&headers, originalTopicHeader, bc.topicId)
			kafkabase.PutKafkaHeader(&headers, retriesCountHeader, strconv.Itoa(retries))
			kafkabase.PutKafkaHeader(&headers, retryTimeHeader, timestamp.ToISOFormat(RetryBackOffTime(bc.config, retries+1).UTC()))
			err = kafkabase.ProduceWithBackpressure(producer, &kafka.Message{
				Key:            message.Key,
				TopicPartition: kafka.TopicPartition{Topic: &failedTopic, Partition: kafka.PartitionAny},
				Headers:        headers,
				Value:          message.Value,
			}, bc.config.ProducerLingerMs/2, 30*time.Second)

			if err != nil {
				return counters, fmt.Errorf("failed to put message to producer: %v", err)
			}
			if deadLettered {
				counters.deadLettered++
			} else {
				counters.retryScheduled++
			}
			if window.remaining() == 0 {
				break
			}
		}
		// Refresh metadata/epoch immediately before each transaction commits.
		groupMetadata, err = bc.consumer.groupMetadata(consumerEpoch)
		if err != nil {
			return counters, err
		}
		err = producer.SendOffsetsToTransaction(context.Background(), transactionOffsets.slice(), groupMetadata)
		if err != nil {
			err = fmt.Errorf("failed to send consumer offset to producer transaction: %v", err)
			return
		}
		err = producer.CommitTransaction(context.Background())
		if err != nil {
			err = fmt.Errorf("failed to commit kafka transaction for producer: %v", err)
			return
		}
		committedPositions.merge(transactionOffsets)
	}
	return
}

func (bc *BatchConsumerImpl) postEventsLog(state bulker.State, processedObjectSample types.Object, batchErr error) {
	if batchErr != nil && state.LastError == nil {
		state.SetError(batchErr)
	}
	batchState := BatchState{State: state, LastMappedRow: processedObjectSample}
	level := eventslog.LevelInfo
	if batchErr != nil {
		level = eventslog.LevelError
	}
	workspaceId := ""
	if destination := bc.repository.GetDestination(bc.destinationId); destination != nil {
		workspaceId = destination.WorkspaceId()
	}
	bc.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeBatch, Level: level, ActorId: bc.destinationId, WorkspaceId: workspaceId, Event: batchState})
}

type BatchState struct {
	bulker.State  `json:",inline"`
	LastMappedRow types.Object `json:"lastMappedRow"`
}
