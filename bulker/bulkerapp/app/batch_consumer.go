package app

import (
	"context"
	"errors"
	"fmt"
	"strconv"
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
	bc.batchSizeFunc = bc.batchSizes
	bc.batchFunc = bc.processBatchImpl
	return &bc, nil
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

func (bc *BatchConsumerImpl) processBatchImpl(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, highOffset int64, updatedHighOffset int) (counters BatchCounters, state bulker.State, nextBatch bool, err error) {
	bc.Debugf("Starting batch #%d", batchNum)
	counters.firstOffset = int64(kafka.OffsetBeginning)
	startTime := time.Now()
	var bulkerStream bulker.BulkerStream
	ctx := context.WithValue(context.Background(), bulker.BatchNumberCtxKey, batchNum)

	//position of last message in batch in case of failed. Needed for processFailed
	var failedPosition *kafka.TopicPartition
	var firstPosition *kafka.TopicPartition
	var latestMessage *kafka.Message
	var processedObjectSample types.Object

	defer func() {
		if counters.consumed > 0 {
			state.QueueSize = max(updatedHighOffset-int(latestMessage.TopicPartition.Offset)-1, 0)
			bc.postEventsLog(state, processedObjectSample, err)
		}
		if err != nil {
			nextBatch = false
			counters.failed = counters.consumed - counters.processed
			if counters.failed > 0 {
				// we separate original errors from retry errors
				metricsMeta := kafkabase.GetKafkaHeader(latestMessage, MetricsMetaHeader)
				bc.SendMetrics(metricsMeta, "error", counters.failed-counters.retried)
				bc.SendMetrics(metricsMeta, "retry_error", counters.retried)
			}
			if failedPosition != nil {
				cnts, err2 := bc.processFailed(firstPosition, failedPosition, err)
				counters.deadLettered = cnts.deadLettered
				counters.retryScheduled = cnts.retryScheduled
				if err2 != nil {
					bc.errorMetric("PROCESS_FAILED_ERROR")
					bc.SystemErrorf(err2.Error())
					bc.restartConsumer(nil)
				} else if counters.failed > 1 && int64(latestMessage.TopicPartition.Offset) < highOffset-1 {
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
	consumer := bc.consumer.Load()
	for i := 0; i < batchSize; i++ {
		if bc.retired.Load() {
			if bulkerStream != nil {
				_ = bulkerStream.Abort(ctx)
			}
			return
		}
		if latestMessage != nil && int64(latestMessage.TopicPartition.Offset) >= highOffset-1 {
			nextBatch = false
			bc.Debugf("Reached watermark offset %d. Stopping batch", highOffset-1)
			// we reached the end of the topic
			break
		}
		if batchSizeBytes > 0 && consumedBytes+maxMessageSize >= batchSizeBytes {
			nextBatch = true
			bc.Debugf("Reached batch size %d of %d. Stopping batch", consumedBytes, batchSizeBytes)
			break
		}
		message, err := consumer.ReadMessage(bc.waitForMessages)
		if err != nil {
			kafkaErr := err.(kafka.Error)
			if kafkaErr.Code() == kafka.ErrTimedOut {
				// waitForMessages period is over. it's ok. considering batch as full
				break
			}
			bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(kafkaErr))
			if bulkerStream != nil {
				_ = bulkerStream.Abort(ctx)
			}
			return counters, state, false, bc.NewError("Failed to consume event from topic. Retryable: %t: %v", kafkaErr.IsRetriable(), kafkaErr)
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
		if firstPosition == nil {
			firstPosition = &message.TopicPartition
			counters.firstOffset = int64(message.TopicPartition.Offset)
		}
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
			failedPosition = &latestMessage.TopicPartition
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
		pauseTimer := time.AfterFunc(time.Duration(bc.config.KafkaMaxPollIntervalMs)*time.Millisecond/2, func() {
			// we need to pause consumer to avoid kafka session timeout while loading huge batches to slow destinations
			bc.pause(true)
		})

		bc.Debugf("Batch #%d Committing %d events to %s", batchNum, processed, destination.config.BulkerType)
		//TODO: do we need to interrupt commit if consumer is retired?
		state, err = bulkerStream.Complete(ctx)
		pauseTimer.Stop()
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
				failedPosition = &latestMessage.TopicPartition
				return counters, state, false, bc.NewError("Failed to commit bulker stream to %s: %v", destination.config.BulkerType, err)
			}
		}
		counters.processed = processed
		counters.processedBytes = consumedBytes
		_, err = consumer.CommitMessage(latestMessage)
		if err != nil {
			bc.errorMetric("KAFKA_COMMIT_ERR:" + metrics.KafkaErrorCode(err))
			bc.Errorf("Failed to commit kafka consumer after batch was successfully committed to the destination: %v", err)
			committed := false
			bc.restartConsumer(func() {
				defer func() {
					if r := recover(); r != nil {
						bc.SystemErrorf("Recovered from panic: %v", r)
					}
				}()
				admin, e1 := kafka.NewAdminClient(bc.kafkaConfig)
				if e1 != nil {
					bc.SystemErrorf("Failed to create kafka admin client: %v", e1)
					return
				} else {
					defer admin.Close()
					gof, e2 := admin.AlterConsumerGroupOffsets(ctx, []kafka.ConsumerGroupTopicPartitions{{Group: bc.topicId, Partitions: []kafka.TopicPartition{{Topic: latestMessage.TopicPartition.Topic, Partition: latestMessage.TopicPartition.Partition, Offset: latestMessage.TopicPartition.Offset + 1}}}})
					if e2 != nil {
						bc.Errorf("Failed to alter consumer group offsets: %v", e2)
					} else {
						committed = true
						bc.Infof("Successfully altered consumer group offsets: %+v", gof)
					}
				}

			})
			if !committed {
				var tp []kafka.TopicPartition
				tp, err = bc.consumer.Load().CommitMessage(latestMessage)
				if err != nil {
					bc.SystemErrorf("Failed to commit kafka consumer after batch was successfully committed to the destination: %v", err)
					err = bc.NewError("Failed to commit kafka consumer: %v", err)
					return
				} else {
					bc.Infof("Successfully committed kafka consumer after initial fail: %+v", tp)
				}
			} else {
				err = nil
			}
		}
	} else if bulkerStream != nil {
		_ = bulkerStream.Abort(ctx)
	}
	return
}

// processFailed consumes the latest failed batch of messages and sends them to the 'failed' topic
func (bc *BatchConsumerImpl) processFailed(firstPosition *kafka.TopicPartition, failedPosition *kafka.TopicPartition, originalErr error) (counters BatchCounters, err error) {
	var producer *kafka.Producer
	var commitedPosition = *firstPosition

	retryBatchSize := bc.config.RetryConsumerBatchSize
	consumer := bc.consumer.Load()

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
			_, err2 := consumer.SeekPartitions([]kafka.TopicPartition{commitedPosition})
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

	bc.resume()

	bc.Infof("Rolling back to first offset %d (failed at %d)", firstPosition.Offset, failedPosition.Offset)
	//Rollback consumer to committed offset
	_, err = consumer.SeekPartitions([]kafka.TopicPartition{*firstPosition})
	if err != nil {
		bc.errorMetric("SEEK_ERROR")
		return BatchCounters{}, fmt.Errorf("failed to rollback kafka consumer offset: %v", err)
	}
	var groupMetadata *kafka.ConsumerGroupMetadata
	groupMetadata, err = consumer.GetConsumerGroupMetadata()
	if err != nil {
		err = fmt.Errorf("failed to get consumer group metadata: %v", err)
		return
	}

	reachedEnd := false
	var message *kafka.Message
	for !reachedEnd {
		err = producer.BeginTransaction()
		if err != nil {
			return BatchCounters{}, fmt.Errorf("failed to begin kafka transaction: %v", err)
		}

		for i := 0; i < retryBatchSize; i++ {
			message, err = consumer.ReadMessage(bc.waitForMessages)
			if err != nil {
				kafkaErr := err.(kafka.Error)
				if kafkaErr.Code() == kafka.ErrTimedOut {
					err = fmt.Errorf("failed to consume message: %v", err)
					return
				}
				if kafkaErr.IsRetriable() {
					time.Sleep(10 * time.Second)
					continue
				} else {
					err = fmt.Errorf("failed to consume message: %v", err)
					return
				}
			}
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
			//stop consuming after the message caused failure
			if message.TopicPartition.Offset == failedPosition.Offset {
				reachedEnd = true
				break
			}
		}
		offset := message.TopicPartition
		offset.Offset++
		//set consumer offset to the next message after failure. that happens atomically with whole producer transaction
		err = producer.SendOffsetsToTransaction(context.Background(), []kafka.TopicPartition{offset}, groupMetadata)
		if err != nil {
			err = fmt.Errorf("failed to send consumer offset to producer transaction: %v", err)
			return
		}
		err = producer.CommitTransaction(context.Background())
		if err != nil {
			err = fmt.Errorf("failed to commit kafka transaction for producer: %v", err)
			return
		}
		commitedPosition = offset
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
	bc.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeBatch, Level: level, ActorId: bc.destinationId, Event: batchState})
}

type BatchState struct {
	bulker.State  `json:",inline"`
	LastMappedRow types.Object `json:"lastMappedRow"`
}
