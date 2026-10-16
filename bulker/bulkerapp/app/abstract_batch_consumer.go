package app

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
)

// retryTimeHeader - time of scheduled retry
const retryTimeHeader = "retry_time"
const retriesCountHeader = "retries"
const streamOptionsKeyHeader = "stream_options"
const originalTopicHeader = "original_topic"
const errorHeader = "error"

type BatchSizesFunction func(*bulker.StreamOptions) (batchSize int, batchSizeBytes int, retryBatchSize int)
type BatchFunction func(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, highOffset int64, updatedHighOffset int, consumerEpoch uint64) (counters BatchCounters, state bulker.State, nextBatch bool, err error)
type ShouldConsumeFunction func(partitionId int32, committedOffset, highOffset int64, consumerEpoch uint64) bool

type BatchConsumer interface {
	Consumer
	RunJob()
	ConsumeAll() (consumed BatchCounters, err error)
	BatchPeriodSec() int
	UpdateBatchPeriod(batchPeriodSec int)
	Options() *bulker.StreamOptions
	Mode() string
}

type AbstractBatchConsumer struct {
	sync.Mutex
	*AbstractConsumer
	repository      *Repository
	destinationId   string
	batchPeriodSec  int
	kafkaConfig     *kafka.ConfigMap
	consumerConfig  kafka.ConfigMap
	consumer        *consumerRuntime
	producerConfig  kafka.ConfigMap
	mode            string
	tableName       string
	waitForMessages time.Duration

	closed    chan struct{}
	closeOnce sync.Once

	running           atomic.Bool
	extraRunScheduled atomic.Bool

	//AbstractBatchConsumer marked as no longer needed. We cannot close it immediately because it can be in the middle of processing batch
	retired atomic.Bool
	//idle AbstractBatchConsumer that is not running any batch jobs. retired idle consumer automatically closes itself
	idle              atomic.Bool
	batchSizeFunc     BatchSizesFunction
	batchFunc         BatchFunction
	shouldConsumeFunc ShouldConsumeFunction
}

func NewAbstractBatchConsumer(repository *Repository, destinationId string, batchPeriodSec int, topicId, mode string, config *Config, kafkaConfig *kafka.ConfigMap, bulkerProducer *Producer, topicManager *TopicManager) (*AbstractBatchConsumer, error) {
	abstract := NewAbstractConsumer(config, repository, topicId, bulkerProducer, topicManager)
	var tableName string
	var err error
	if destinationId != "" {
		_, _, tableName, err = ParseTopicId(topicId)
		if err != nil {
			metrics.ConsumerErrors(topicId, mode, "INVALID_TOPIC", "INVALID_TOPIC", "failed to parse topic").Inc()
			return nil, abstract.NewError("Failed to parse topic: %v", err)
		}
	}

	consumerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
		"group.id":                        topicId,
		"auto.offset.reset":               "earliest",
		"allow.auto.create.topics":        false,
		"enable.auto.commit":              false,
		"go.application.rebalance.enable": true,
		"partition.assignment.strategy":   config.KafkaConsumerPartitionsAssigmentStrategy,
		"isolation.level":                 "read_committed",
		"session.timeout.ms":              config.KafkaSessionTimeoutMs,
		"fetch.message.max.bytes":         config.KafkaFetchMessageMaxBytes,
		"max.poll.interval.ms":            config.KafkaMaxPollIntervalMs,
	}, *kafkaConfig))

	producerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
		"transactional.id":             fmt.Sprintf("%s_failed_%s", topicId, config.InstanceId),
		"queue.buffering.max.messages": config.ProducerQueueSize,
		"batch.size":                   config.ProducerBatchSize,
		"linger.ms":                    config.ProducerLingerMs,
		"compression.type":             config.KafkaTopicCompression,
	}, *kafkaConfig))

	bc := &AbstractBatchConsumer{
		AbstractConsumer: abstract,
		repository:       repository,
		destinationId:    destinationId,
		tableName:        tableName,
		batchPeriodSec:   batchPeriodSec,
		mode:             mode,
		kafkaConfig:      kafkaConfig,
		consumerConfig:   consumerConfig,
		producerConfig:   producerConfig,
		waitForMessages:  time.Duration(config.BatchRunnerWaitForMessagesSec) * time.Second,
		closed:           make(chan struct{}),
	}
	bc.consumer = newConsumerRuntime(consumerConfig, topicId, consumerRuntimeHooks{
		debugf:       bc.Debugf,
		infof:        bc.Infof,
		errorf:       bc.Errorf,
		onKafkaError: bc.onConsumerError,
	}, time.Duration(config.KafkaMaxPollIntervalMs)*time.Millisecond)
	bc.idle.Store(true)
	return bc, nil
}

func (bc *AbstractBatchConsumer) initTransactionalProducer() (*kafka.Producer, error) {
	//start := time.Now()
	producer, err := kafka.NewProducer(&bc.producerConfig)
	if err != nil {
		metrics.ConsumerErrors(bc.topicId, bc.mode, bc.destinationId, bc.tableName, metrics.KafkaErrorCode(err)).Inc()
		return nil, fmt.Errorf("error creating kafka producer: %v", err)
	}
	err = producer.InitTransactions(nil)
	if err != nil {
		metrics.ConsumerErrors(bc.topicId, bc.mode, bc.destinationId, bc.tableName, metrics.KafkaErrorCode(err)).Inc()
		return nil, fmt.Errorf("error initializing kafka producer transactions: %v", err)
	}
	// Delivery reports channel for 'failed' producer messages
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Second)
		errors := map[string]*int{}
		defer ticker.Stop()
		for {
			select {
			case <-bc.closed:
				bc.Infof("Closing producer.")
				producer.Close()
				return
			case <-ticker.C:
				if len(errors) > 0 {
					for k, v := range errors {
						bc.Errorf("%s COUNT: %d", k, *v)
					}
					clear(errors)
				}
			case e := <-producer.Events():
				switch ev := e.(type) {
				case *kafka.Message:
					if ev.TopicPartition.Error != nil {
						kafkabase.ProducerMessages(ProducerMessageLabels(*ev.TopicPartition.Topic, "error", metrics.KafkaErrorCode(ev.TopicPartition.Error))).Inc()
						errtext := fmt.Sprintf("Error sending message to kafka topic %s: %s", *ev.TopicPartition.Topic, ev.TopicPartition.Error.Error())
						zero := 0
						cnt := utils.MapGetOrCreate(errors, errtext, &zero)
						*cnt++
						//bc.Errorf("%s %d", errtext, len(errors))
					} else {
						kafkabase.ProducerMessages(ProducerMessageLabels(*ev.TopicPartition.Topic, "delivered", "")).Inc()
						//bc.Debugf("Message ID: %s delivered to topic %s [%d] at offset %v", messageId, *ev.TopicPartition.Topic, ev.TopicPartition.Partition, ev.TopicPartition.Offset)
					}
				case *kafka.Error, kafka.Error:
					bc.Errorf("Producer error: %v", ev)
				case nil:
					bc.Debugf("Producer closed")
					return
				}
			}
		}
	})
	//bc.Infof("Producer initialized in %s", time.Since(start))
	return producer, nil
}

func (bc *AbstractBatchConsumer) BatchPeriodSec() int {
	return bc.batchPeriodSec
}

func (bc *AbstractBatchConsumer) UpdateBatchPeriod(batchPeriodSec int) {
	bc.batchPeriodSec = batchPeriodSec
}

func (bc *AbstractBatchConsumer) TopicId() string {
	return bc.topicId
}

func (bc *AbstractBatchConsumer) RunJob() {
	if bc.running.CompareAndSwap(false, true) {
		startedAt := time.Now()
		defer func() {
			bc.idle.Store(true)
			bc.pauseOrSuspend(startedAt)
			bc.running.Store(false)
		}()
		_, _ = bc.ConsumeAll()
		for bc.extraRunScheduled.CompareAndSwap(true, false) {
			_, _ = bc.ConsumeAll()
		}
	} else {
		bc.extraRunScheduled.Store(true)
	}
}

func (bc *AbstractBatchConsumer) ConsumeAll() (counters BatchCounters, err error) {
	bc.Lock()
	defer bc.Unlock()
	if bc.retired.Load() {
		bc.Errorf("No messages were consumed. Consumer is retired.")
		return BatchCounters{}, bc.NewError("Consumer is retired")
	}
	startedAt := time.Now()
	var totalState bulker.State
	counters.firstOffset = int64(kafka.OffsetBeginning)
	bc.Debugf("Starting consuming messages from topic")
	bc.idle.Store(false)
	commitedOffset := int64(kafka.OffsetBeginning)
	var highOffset int64
	var updatedHighOffset int64
	defer func() {
		sec := time.Since(startedAt).Seconds()
		if err != nil {
			metrics.ConsumerRuns(bc.topicId, bc.mode, bc.destinationId, bc.tableName, "fail").Inc()
			bc.Errorf("Consume finished with error: %v stats: %s offsets: %d-%d time: %.2f s.", err, counters.String(), commitedOffset, highOffset, sec)
		} else {
			metrics.ConsumerRuns(bc.topicId, bc.mode, bc.destinationId, bc.tableName, "success").Inc()
			if counters.processed > 0 {
				bc.Infof("Successfully %s offsets: %d-%d time: %.2f s. AvgSpd: %.2f e/s. States: %s", counters.String(), commitedOffset, highOffset, sec, float64(counters.processed)/sec, totalState.PrintWarehouseState())
			} else {
				countersString := counters.String()
				if countersString != "" {
					if bc.mode == "retry" {
						bc.Infof("Retry consumer finished: %s offsets: %d-%d time: %.2f s.", countersString, commitedOffset, highOffset, sec)
					} else {
						bc.Infof("No messages were processed: %s offsets: %d-%d time: %.2f s.", countersString, commitedOffset, highOffset, sec)
					}
				} else {
					bc.Debugf("No messages were processed. offsets: %d-%d time: %.2f s.", commitedOffset, highOffset, sec)
				}
			}
		}
	}()
	streamOptions := &bulker.StreamOptions{}
	var destination *Destination
	if bc.destinationId != "" {
		destination = bc.repository.LeaseDestination(bc.destinationId)
		if destination == nil {
			bc.Retire()
			return BatchCounters{}, bc.NewError("destination not found: %s. Retiring consumer", bc.destinationId)
		}
		streamOptions = destination.streamOptions
		defer func() {
			destination.Release()
		}()
	}

	maxBatchSize, maxBatchSizeBytes, retryBatchSize := bc.batchSizeFunc(streamOptions)
	created, err := bc.initConsumer()
	if err != nil {
		bc.errorMetric("resume_error")
		return BatchCounters{}, bc.NewError("Failed to resume kafka consumer: %v", err)
	}
	assignmentWait := time.Duration(0)
	if created {
		assignmentWait = time.Duration(bc.config.KafkaSessionTimeoutMs) * time.Millisecond
	}
	assignments, consumerEpoch, err := bc.consumer.assignment(assignmentWait)
	if err != nil {
		bc.errorMetric("assignment_error")
		return BatchCounters{}, bc.NewError("Failed to get consumer assignment: %v", err)
	}
	if len(assignments) == 0 {
		//An empty assignment is valid in a shared consumer group. The runtime
		//continues polling and will receive work after a later rebalance.
		bc.Debugf("No partitions assigned to this healthy group member")
		return BatchCounters{}, nil
	}
	if len(assignments) != 1 {
		bc.errorMetric("assignment_error")
		return BatchCounters{}, bc.NewError("Expected one assigned partition, got %d", len(assignments))
	}
	partition := assignments[0].Partition
	bc.Debugf("Using assigned partition %d at epoch %d", partition, consumerEpoch)
	_, highOffset, err = bc.consumer.queryWatermarkOffsets(bc.topicId, partition, 10_000, consumerEpoch)
	updatedHighOffset = highOffset
	offsets, erro := bc.consumer.committed([]kafka.TopicPartition{{Topic: &bc.topicId, Partition: partition}}, 10_000, consumerEpoch)
	if erro != nil {
		bc.errorMetric("query_committed_failed")
		bc.Errorf("Failed to query committed offsets: %v", erro)
	} else if len(offsets) > 0 && offsets[0].Offset != kafka.OffsetInvalid {
		commitedOffset = int64(offsets[0].Offset)
	} else {
		//Not an error by itself: a brand-new topic has no committed offset until
		//its first batch.
		bc.Infof("No committed offset for the consumer group yet. High watermark: %d", highOffset)
	}
	if err != nil {
		bc.errorMetric("query_watermark_failed")
		return BatchCounters{}, bc.NewError("Failed to query watermark offsets: %v", err)
	}
	if !bc.shouldConsume(partition, commitedOffset, highOffset, consumerEpoch) {
		bc.Debugf("Consumer should not consume. offsets: %d-%d", commitedOffset, highOffset)
		return BatchCounters{}, nil
	}
	lastOffsetQueryTime := time.Now()
	bc.Debugf("Starting consuming messages from topic. Messages in topic: ~%d. ", highOffset-commitedOffset)
	batchNumber := 1
	for {
		if bc.retired.Load() {
			return
		}
		if bc.destinationId != "" {
			currentDst := bc.repository.GetDestination(bc.destinationId)
			if currentDst == nil || currentDst.configHash != destination.configHash {
				bc.Infof("Destination config has changed. Finishing this batch.")
				return
			}
		}
		batchCounters, batchState, nextBatch, err2 := bc.processBatch(destination, batchNumber, maxBatchSize, maxBatchSizeBytes, retryBatchSize, highOffset, int(updatedHighOffset), consumerEpoch)
		if err2 != nil {
			if nextBatch {
				bc.Errorf("Batch finished with error: %v stats: %s nextBatch: %t", err2, batchCounters, nextBatch)
			}
		}
		bc.countersMetric(batchCounters)
		totalState.Merge(batchState)
		counters.accumulate(batchCounters)
		if batchCounters.consumed > 0 {
			if time.Since(lastOffsetQueryTime) > 1*time.Minute || !nextBatch {
				var err1 error
				_, updatedHighOffset, err1 = bc.consumer.queryWatermarkOffsets(bc.topicId, partition, 10_000, consumerEpoch)
				if err1 != nil {
					bc.Errorf("Failed to query watermark offsets: %v", err1)
					bc.errorMetric("query_watermark_failed")
				}
				lastOffsetQueryTime = time.Now()
			}
			queueSize := math.Max(float64(updatedHighOffset-batchCounters.firstOffset-int64(batchCounters.consumed)), 0)
			metrics.ConsumerQueueSize(bc.topicId, bc.mode, bc.destinationId, bc.tableName).Set(queueSize)
		}
		if !nextBatch {
			err = err2
			return
		}
		batchNumber++
	}
}

func (bc *AbstractBatchConsumer) close() error {
	var err error
	bc.closeOnce.Do(func() {
		close(bc.closed)
		err = bc.consumer.close()
	})
	return err
}

func (bc *AbstractBatchConsumer) processBatch(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, highOffset int64, updatedHighOffset int, consumerEpoch uint64) (counters BatchCounters, state bulker.State, nextBath bool, err error) {
	bc.resume()
	return bc.batchFunc(destination, batchNum, batchSize, batchSizeBytes, retryBatchSize, highOffset, updatedHighOffset, consumerEpoch)
}

func (bc *AbstractBatchConsumer) shouldConsume(partitionId int32, committedOffset, highOffset int64, consumerEpoch uint64) bool {
	if highOffset == 0 || committedOffset == highOffset {
		return false
	}
	if bc.shouldConsumeFunc != nil {
		bc.resume()
		return bc.shouldConsumeFunc(partitionId, committedOffset, highOffset, consumerEpoch)
	}
	return true
}

func (bc *AbstractBatchConsumer) pauseOrSuspend(startedAt time.Time) {
	if bc.idle.Load() && bc.retired.Load() {
		bc.Infof("Consumer is retired. Closing")
		_ = bc.close()
		return
	}
	batchPeriodSec := bc.BatchPeriodSec()
	timeToNextBatch := time.Duration(batchPeriodSec)*time.Second - time.Since(startedAt)
	if bc.config.SuspendConsumers && timeToNextBatch >= 60*time.Second {
		bc.Infof("Suspending consumer %s for %s", bc.consumer.description(), timeToNextBatch)
		if err := bc.consumer.suspend(); err != nil && !errors.Is(err, errConsumerNotStarted) {
			bc.Errorf("Failed to suspend Kafka consumer: %v", err)
		}
	} else {
		bc.pause(false)
	}
}

func (bc *AbstractBatchConsumer) pause(_ bool) {
	if err := bc.consumer.pause(); err != nil && !errors.Is(err, errConsumerNotStarted) {
		bc.errorMetric("pause_error")
		bc.SystemErrorf("Failed to pause Kafka consumer: %v", err)
	}
}

func (bc *AbstractBatchConsumer) initConsumer() (bool, error) {
	created, err := bc.consumer.init()
	if err != nil {
		bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(err))
		bc.Errorf("Error creating Kafka consumer: %v", err)
	}
	return created, err
}

func (bc *AbstractBatchConsumer) membershipLost(reason string) {
	bc.errorMetric("membership_lost")
	bc.Errorf("Consumer group membership lost: %s", reason)
}

func (bc *AbstractBatchConsumer) onConsumerError(kafkaErr kafka.Error) {
	bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(kafkaErr))
	if reason := membershipLossReason(kafkaErr); reason != "" {
		bc.membershipLost(reason)
	}
}

func (bc *AbstractBatchConsumer) restartConsumer(beforeInit func()) {
	if bc.retired.Load() {
		return
	}
	bc.Infof("Restarting consumer")
	if err := bc.consumer.restart(beforeInit); err != nil {
		bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(err))
		bc.Errorf("Failed to restart Kafka consumer: %v", err)
	}
}

func (bc *AbstractBatchConsumer) resume() {
	if err := bc.consumer.resume(); err != nil && !errors.Is(err, errConsumerNotStarted) {
		bc.errorMetric("resume_error")
		bc.SystemErrorf("Failed to resume Kafka consumer: %v", err)
	}
}

// Retire Mark consumer as retired
// Consumer will close itself when com
func (bc *AbstractBatchConsumer) Retire() {
	bc.Infof("Retiring %s consumer", bc.mode)
	bc.retired.Store(true)
	if bc.idle.Load() {
		_ = bc.close()
	}
}
func (bc *AbstractBatchConsumer) errorMetric(errorType string) {
	metrics.ConsumerErrors(bc.topicId, bc.mode, bc.destinationId, bc.tableName, errorType).Inc()
}

func (bc *AbstractBatchConsumer) Mode() string {
	return bc.mode
}

func (bc *AbstractBatchConsumer) Options() *bulker.StreamOptions {
	if bc.destinationId != "" {
		currentDst := bc.repository.GetDestination(bc.destinationId)
		if currentDst != nil {
			return currentDst.streamOptions
		}
	}
	return &bulker.StreamOptions{}
}

func (bc *AbstractBatchConsumer) countersMetric(counters BatchCounters) {
	countersValue := reflect.ValueOf(counters)
	countersType := countersValue.Type()
	for i := 0; i < countersValue.NumField(); i++ {
		metricName := countersType.Field(i).Name
		if metricName == "firstOffset" {
			continue
		}
		value := countersValue.Field(i).Int()
		if value > 0 {
			metrics.ConsumerMessages(bc.topicId, bc.mode, bc.destinationId, bc.tableName, metricName).Add(float64(value))
			if metricName == "processed" {
				metrics.ConnectionMessageStatuses(bc.destinationId, bc.tableName, "success").Add(float64(value))
			} else if metricName == "failed" {
				metrics.ConnectionMessageStatuses(bc.destinationId, bc.tableName, "error").Add(float64(value))
			} else if metricName == "retried" || metricName == "deadLettered" {
				metrics.ConnectionMessageStatuses(bc.destinationId, bc.tableName, metricName).Add(float64(value))
			}
		}
	}
}

// membershipLossReason maps a kafka error to a human-readable reason when it
// means the consumer is no longer a member of its group, or "" otherwise.
// These are the ways a static member drops out: it stopped polling in time
// (librdkafka leaves the group itself), a newer instance with the same
// group.instance.id took its place, or the coordinator forgot it.
func membershipLossReason(kafkaErr kafka.Error) string {
	switch kafkaErr.Code() {
	case kafka.ErrMaxPollExceeded:
		return "max.poll.interval.ms exceeded, librdkafka left the group"
	case kafka.ErrFencedInstanceID, kafka.ErrFenced:
		return "fenced by another consumer with the same group.instance.id"
	case kafka.ErrUnknownMemberID:
		return "coordinator no longer knows this member"
	}
	if kafkaErr.IsFatal() {
		return fmt.Sprintf("fatal consumer error: %v", kafkaErr)
	}
	return ""
}

type BatchCounters struct {
	consumed        int
	skipped         int
	processed       int
	processedBytes  int
	notReadyReadded int
	retryScheduled  int
	retried         int
	deadLettered    int
	failed          int
	firstOffset     int64
}

// accumulate stats from batch
func (bs *BatchCounters) accumulate(batchStats BatchCounters) {
	bs.consumed += batchStats.consumed
	bs.processedBytes += batchStats.processedBytes
	bs.skipped += batchStats.skipped
	bs.processed += batchStats.processed
	bs.notReadyReadded += batchStats.notReadyReadded
	bs.retryScheduled += batchStats.retryScheduled
	bs.deadLettered += batchStats.deadLettered
	bs.retried += batchStats.retried
	if bs.firstOffset < 0 && batchStats.firstOffset >= 0 {
		bs.firstOffset = batchStats.firstOffset
	}
}

// to string
func (bs *BatchCounters) String() string {
	// print non-zero values
	var sb strings.Builder
	countersValue := reflect.ValueOf(*bs)
	countersType := countersValue.Type()
	for i := 0; i < countersValue.NumField(); i++ {
		value := countersValue.Field(i).Int()
		if value > 0 {
			sb.WriteString(fmt.Sprintf("%s: %d ", countersType.Field(i).Name, value))
		}
	}
	return sb.String()
}
