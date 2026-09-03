package app

import (
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

const pauseHeartBeatInterval = 120 * time.Second

// assignmentFailuresBeforeRestart - consecutive runs a retry consumer may end
// without a partition assignment before it is treated as having lost its group
// membership. More than one, so an ordinary rebalance is not mistaken for a
// zombie (see ConsumeAll).
const assignmentFailuresBeforeRestart = 3

type BatchSizesFunction func(*bulker.StreamOptions) (batchSize int, batchSizeBytes int, retryBatchSize int)
type BatchFunction func(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, highOffset int64, updatedHighOffset int) (counters BatchCounters, state bulker.State, nextBatch bool, err error)
type ShouldConsumeFunction func(partitionId int32, committedOffset, highOffset int64) bool

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
	consumer        atomic.Pointer[kafka.Consumer]
	producerConfig  kafka.ConfigMap
	mode            string
	tableName       string
	waitForMessages time.Duration

	closed chan struct{}

	running           atomic.Bool
	extraRunScheduled atomic.Bool

	//AbstractBatchConsumer marked as no longer needed. We cannot close it immediately because it can be in the middle of processing batch
	retired atomic.Bool
	//idle AbstractBatchConsumer that is not running any batch jobs. retired idle consumer automatically closes itself
	idle atomic.Bool
	//consumer can be paused between batches(idle) and also can be paused during loading batch to destination(not idle)
	paused        atomic.Bool
	resumeChannel chan struct{}
	//stopChannel signals the pause heartbeat loop to exit for suspend (vs.
	//resume). It is unbuffered on purpose: _unpause() must block until the
	//heartbeat has actually left its loop, so pauseOrSuspend can close the
	//consumer without racing an in-flight ReadMessage (see _unpause).
	stopChannel chan struct{}
	//restarting guards against piling up overlapping restartConsumer calls
	//from the pause heartbeat loop (see restartConsumerAsync).
	restarting atomic.Bool
	//restartMu serializes restartConsumer (see there).
	restartMu sync.Mutex
	//consumerCreatedAt is when the current kafka consumer was created (unix
	//nanos). A consumer needs a poll to join the group and get its assignment,
	//so membership checks only apply once it is older than a grace period.
	consumerCreatedAt atomic.Int64
	//restartGeneration counts restarts, which suffix the static
	//group.instance.id so a replacement is never fenced against the consumer
	//it replaces (see newConsumer).
	restartGeneration atomic.Int64
	//assignmentFailures counts consecutive runs that ended without a partition
	//assignment (retry mode). One is a rebalance; several in a row is a zombie.
	assignmentFailures atomic.Int64
	//closedConsumers records every *kafka.Consumer this object has closed.
	//Several paths may hold the same pointer (suspend, restart quarantine,
	//close), and confluent-kafka-go panics on a second Close, so all closes go
	//through closeConsumer. One entry per restart; restarts are rare, so the
	//set is never pruned.
	closedMu        sync.Mutex
	closedConsumers map[*kafka.Consumer]struct{}

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
		"group.id":                      topicId,
		"auto.offset.reset":             "earliest",
		"allow.auto.create.topics":      false,
		"group.instance.id":             abstract.GetInstanceId(),
		"enable.auto.commit":            false,
		"partition.assignment.strategy": config.KafkaConsumerPartitionsAssigmentStrategy,
		"isolation.level":               "read_committed",
		"session.timeout.ms":            config.KafkaSessionTimeoutMs,
		"fetch.message.max.bytes":       config.KafkaFetchMessageMaxBytes,
		"max.poll.interval.ms":          config.KafkaMaxPollIntervalMs,
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
		//buffered size 1: resume() can deposit the signal even if the
		//heartbeat goroutine is mid-iteration (e.g. blocked in
		//restartConsumer); the heartbeat picks it up on the next pass.
		resumeChannel: make(chan struct{}, 1),
		//unbuffered: suspend must rendezvous with the heartbeat (see field doc).
		stopChannel:     make(chan struct{}),
		closedConsumers: map[*kafka.Consumer]struct{}{},
	}
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
	consumer, created, err := bc.initConsumer()
	if err != nil {
		bc.errorMetric("resume_error")
		return BatchCounters{}, bc.NewError("Failed to resume kafka consumer: %v", err)
	}
	var partition int32 = 0
	if bc.mode == "retry" {
		var ass []kafka.TopicPartition
		var err error
		for i := 0; i < 10; i++ {
			ass, err = consumer.Assignment()
			if err == nil && len(ass) == 1 {
				break
			}
			// rebalance events are served only during poll calls:
			// poll the consumer so it can join the group and obtain its assignment
			message, _ := consumer.ReadMessage(time.Second * time.Duration(i+1))
			if message != nil {
				// a message slipped through before batch processing started - rollback the position
				_, seekErr := consumer.SeekPartitions([]kafka.TopicPartition{message.TopicPartition})
				if seekErr != nil {
					bc.SystemErrorf("Failed to seek back a message received while waiting for assignment: %v", seekErr)
				}
			}
		}
		if err != nil || len(ass) != 1 {
			bc.errorMetric("assignment_error")
			//A single failure is not treated as lost membership (JITSU-214):
			//retry consumers of one topic share a group across the fleet, one
			//partition each, so missing an assignment in this window is routine
			//during a rebalance, and restarting would rejoin under a new
			//instance id and force another fleet-wide rebalance. A rebalance
			//settles within a session timeout, so several runs in a row without
			//an assignment is a zombie rather than churn.
			if !created && bc.assignmentFailures.Add(1) >= assignmentFailuresBeforeRestart {
				bc.membershipLost(fmt.Sprintf("no partition assignment in %d consecutive runs", assignmentFailuresBeforeRestart))
				bc.assignmentFailures.Store(0)
				bc.restartConsumer(nil)
			}
			return BatchCounters{}, bc.NewError("Failed to get consumer assignment (%d): %v", len(ass), err)
		}
		bc.assignmentFailures.Store(0)
		partition = ass[0].Partition
		bc.Infof("Assigned partition: %d", partition)
	}
	_, highOffset, err = consumer.QueryWatermarkOffsets(bc.topicId, partition, 10_000)
	updatedHighOffset = highOffset
	offsets, erro := consumer.Committed([]kafka.TopicPartition{{Topic: &bc.topicId, Partition: partition}}, 10_000)
	if erro != nil {
		bc.errorMetric("query_committed_failed")
		bc.Errorf("Failed to query committed offsets: %v", erro)
	} else if len(offsets) > 0 && offsets[0].Offset != kafka.OffsetInvalid {
		commitedOffset = int64(offsets[0].Offset)
	} else {
		//Not an error by itself: a brand-new topic has no committed offset until
		//its first batch. It is also what a consumer whose group was deleted
		//sees — that case is caught by the membership check below.
		bc.Infof("No committed offset for the consumer group yet. High watermark: %d", highOffset)
	}
	if err != nil {
		bc.errorMetric("query_watermark_failed")
		return BatchCounters{}, bc.NewError("Failed to query watermark offsets: %v", err)
	}
	if !created && bc.mode != "retry" && hasLag(commitedOffset, highOffset) {
		//Self-heal (JITSU-214). Topics are sharded, so this consumer is the
		//group's only member for its partition: if it has been alive long enough
		//to have joined and still owns nothing while messages are waiting, it
		//has dropped out of the group (max.poll.interval exceeded, fenced by a
		//restart, or the empty group was garbage-collected by the broker) and
		//would otherwise poll nothing every period forever, looking idle.
		if reason := bc.assignmentLost(consumer); reason != "" {
			bc.membershipLost(reason)
			bc.restartConsumer(nil)
			consumer = bc.consumer.Load()
			if consumer == nil {
				bc.errorMetric("resume_error")
				return BatchCounters{}, bc.NewError("Failed to recreate kafka consumer after losing group membership")
			}
		}
	}
	if !bc.shouldConsume(partition, commitedOffset, highOffset) {
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
		batchCounters, batchState, nextBatch, err2 := bc.processBatch(destination, batchNumber, maxBatchSize, maxBatchSizeBytes, retryBatchSize, highOffset, int(updatedHighOffset))
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
				consumer = bc.consumer.Load()
				_, updatedHighOffset, err1 = consumer.QueryWatermarkOffsets(bc.topicId, partition, 10_000)
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
	select {
	case <-bc.closed:
	default:
		close(bc.closed)
	}
	consumer := bc.consumer.Swap(nil)
	if consumer != nil {
		return bc.closeConsumer(consumer)
	}
	return nil
}

// closeConsumer closes a kafka consumer exactly once, however many paths hold
// its pointer (see closedConsumers). Returns the Close error, or nil when the
// consumer was already closed by another path.
func (bc *AbstractBatchConsumer) closeConsumer(consumer *kafka.Consumer) error {
	bc.closedMu.Lock()
	if _, done := bc.closedConsumers[consumer]; done {
		bc.closedMu.Unlock()
		return nil
	}
	bc.closedConsumers[consumer] = struct{}{}
	bc.closedMu.Unlock()
	e1 := consumer.Unsubscribe()
	e2 := consumer.Close()
	bc.Infof("Consumer closed: %s unsubscribe: %v close: %v", consumer.String(), e1, e2)
	return e2
}

// quarantineClose closes a consumer that has just been replaced, after a delay
// long enough for anything that loaded the old pointer before the swap — the
// paused heartbeat mid-ReadMessage, most importantly — to return from it.
// librdkafka is not safe against a poll racing a Close on the same instance.
//
// The delay also bounds how long a replaced static member stays registered:
// it is deregistered a session timeout after this close, and only then is its
// base group.instance.id free again. Keep
// BATCH_RUNNER_WAIT_FOR_MESSAGES_SEC + 5s + KAFKA_SESSION_TIMEOUT_MS under the
// 60s minimum gap that pauseOrSuspend requires before suspending, so a
// suspended consumer recreated with the base id never collides with it.
func (bc *AbstractBatchConsumer) quarantineClose(consumer *kafka.Consumer) {
	safego.RunWithRestart(func() {
		time.Sleep(bc.waitForMessages + 5*time.Second)
		_ = bc.closeConsumer(consumer)
	})
}

func (bc *AbstractBatchConsumer) processBatch(destination *Destination, batchNum, batchSize, batchSizeBytes, retryBatchSize int, highOffset int64, updatedHighOffset int) (counters BatchCounters, state bulker.State, nextBath bool, err error) {
	bc.resume()
	return bc.batchFunc(destination, batchNum, batchSize, batchSizeBytes, retryBatchSize, highOffset, updatedHighOffset)
}

func (bc *AbstractBatchConsumer) shouldConsume(partitionId int32, committedOffset, highOffset int64) bool {
	if highOffset == 0 || committedOffset == highOffset {
		return false
	}
	if bc.shouldConsumeFunc != nil {
		bc.resume()
		return bc.shouldConsumeFunc(partitionId, committedOffset, highOffset)
	}
	return true
}

func (bc *AbstractBatchConsumer) pauseOrSuspend(startedAt time.Time) {
	if bc.idle.Load() && bc.retired.Load() {
		// Close retired idling consumer
		bc.Infof("Consumer is retired. Closing")
		_ = bc.close()
		return
	}
	consumer := bc.consumer.Load()
	if consumer == nil {
		return
	}
	batchPeriodSec := bc.BatchPeriodSec()
	timeToNextBatch := time.Duration(batchPeriodSec)*time.Second - time.Since(startedAt)
	if bc.config.SuspendConsumers && timeToNextBatch >= 60*time.Second {
		bc.Infof("Suspending consumer %s for %s", consumer.String(), timeToNextBatch)
		bc._unpause()
		//only suspend the consumer we looked at: a restart may have swapped in
		//a new one meanwhile, and storing nil over it would leak a live group
		//member. That one stays up and is used by the next period.
		if bc.consumer.CompareAndSwap(consumer, nil) {
			_ = bc.closeConsumer(consumer)
		} else {
			bc.Infof("Consumer was replaced while suspending. Keeping the new one")
		}
	} else {
		bc.pause(false)
	}
}

// pause consumer.
func (bc *AbstractBatchConsumer) pause(immediatePoll bool) {
	if !bc.paused.CompareAndSwap(false, true) {
		return
	}
	//drain any stale resume signal left over from a prior cycle so the new
	//heartbeat goroutine doesn't break out of its loop on the first pass.
	select {
	case <-bc.resumeChannel:
	default:
	}
	bc.pauseKafkaConsumer()

	safego.RunWithRestart(func() {
		errorReported := false
		firstPoll := immediatePoll
		//this loop keeps heatbeating consumer to prevent it from being kicked out from group
		pauseTicker := time.NewTicker(bc.heartbeatInterval())
		defer pauseTicker.Stop()
	loop:
		for {
			if bc.idle.Load() && bc.retired.Load() {
				// Close retired idling consumer
				bc.Infof("Consumer is retired. Closing")
				_ = bc.close()
				return
			}
			if !firstPoll {
				select {
				case <-bc.resumeChannel:
					bc.paused.CompareAndSwap(true, false)
					//Defensive: resume() may have called consumer.Resume on
					//a consumer that was since replaced (e.g. by an in-flight
					//restartConsumer). Re-resume the current one so the kafka
					//state matches paused=false even after that race.
					if currentConsumer := bc.consumer.Load(); currentConsumer != nil {
						if parts, perr := currentConsumer.Assignment(); perr == nil {
							_ = currentConsumer.Resume(parts)
						}
					}
					bc.Debugf("Consumer resumed.")
					break loop
				case <-bc.stopChannel:
					//Suspend path: the caller (pauseOrSuspend) is about to close
					//the consumer, so we only stop heartbeating — no Resume.
					//Because stopChannel is unbuffered, _unpause is still blocked
					//on the send here, guaranteeing the consumer is no longer in
					//ReadMessage when Close runs.
					bc.paused.CompareAndSwap(true, false)
					bc.Debugf("Consumer heartbeat stopped for suspend.")
					break loop
				case <-pauseTicker.C:
				}
			}
			firstPoll = false
			consumer := bc.consumer.Load()
			if consumer == nil {
				bc.Errorf("Paused Consumer is nil.")
				continue
			}
			message, err := consumer.ReadMessage(bc.waitForMessages)
			if err != nil {
				kafkaErr := err.(kafka.Error)
				if kafkaErr.Code() == kafka.ErrTimedOut {
					bc.Debugf("Consumer paused. Heartbeat sent.")
					continue
				}
				bc.errorMetric("error_while_paused")
				if !errorReported {
					bc.Errorf("Error on paused consumer: %v", kafkaErr)
					errorReported = true
				}
				if reason := membershipLossReason(kafkaErr); reason != "" {
					//left the group: waiting does not bring it back (that is the
					//zombie this fix is about), so rejoin with a new consumer
					bc.membershipLost(reason)
					bc.restartConsumerAsync()
				} else if kafkaErr.IsRetriable() && !kafkaErr.IsFatal() {
					time.Sleep(10 * time.Second)
				} else {
					//restartConsumer can block for KafkaSessionTimeoutMs + 15s per
					//failed creation attempt (broker unreachable); running it
					//synchronously here would starve the resumeChannel select and
					//trip "Resume timeout" in resume() once 5 min elapses.
					bc.restartConsumerAsync()
				}
			} else if message != nil {
				bc.Debugf("Unexpected message on paused consumer: %v", message)
				//If message slipped through pause, rollback offset and make sure consumer is paused
				_, err = consumer.SeekPartitions([]kafka.TopicPartition{message.TopicPartition})
				if err != nil {
					bc.errorMetric("ROLLBACK_ON_PAUSE_ERR")
					bc.SystemErrorf("Failed to rollback offset on paused consumer: %v", err)
					bc.restartConsumerAsync()
				}
				bc.pauseKafkaConsumer()
			}
		}
	})
}

// initConsumer returns the current kafka consumer, creating one when there is
// none. `created` reports whether this call made it: a new consumer has not
// polled yet, so it has no assignment and no group membership to check.
func (bc *AbstractBatchConsumer) initConsumer() (consumer *kafka.Consumer, created bool, err error) {
	consumer = bc.consumer.Load()
	if consumer != nil {
		return consumer, false, nil
	}
	consumer, err = bc.newConsumer(false)
	if err != nil {
		return nil, false, err
	}
	bc.consumer.Store(consumer)
	return consumer, true, nil
}

// newConsumer creates and subscribes a kafka consumer without publishing it.
//
// A restart gets a "-rN" suffix on the static group.instance.id, because the
// consumer it replaces is still a live group member for up to a session
// timeout and two members sharing an instance id fence each other. Any other
// creation — the first one, or one after a suspend, where the previous member
// is long gone — keeps the base id, so a pod restart resumes as the same
// static member and the partition assignment order across instances holds.
func (bc *AbstractBatchConsumer) newConsumer(restart bool) (*kafka.Consumer, error) {
	config := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{}, bc.consumerConfig))
	instanceId := bc.GetInstanceId()
	if restart {
		instanceId = fmt.Sprintf("%s-r%d", instanceId, bc.restartGeneration.Add(1))
		config["group.instance.id"] = instanceId
	}
	consumer, err := kafka.NewConsumer(&config)
	if err != nil {
		bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(err))
		bc.Errorf("Error creating kafka consumer: %v", err)
		return nil, err
	}
	err = consumer.SubscribeTopics([]string{bc.topicId}, bc.rebalanceCallback)
	if err != nil {
		bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(err))
		_ = consumer.Close()
		bc.Errorf("Failed to subscribe to topic: %v", err)
		return nil, err
	}
	//if bc.mode == "retry" && bc.topicId == bc.config.KafkaDestinationsRetryTopicName {
	//	consumer.Assign([]kafka.TopicPartition{kafka.TopicPartition{Topic: &bc.topicId, Offset: kafka.OffsetStored, Partition: int32(bc.config.InstanceIndex)}})
	//}
	bc.consumerCreatedAt.Store(time.Now().UnixNano())
	bc.Infof("Consumer created: %s (group.instance.id: %s)", consumer.String(), instanceId)
	return consumer, nil
}

// heartbeatInterval is how often a paused consumer is polled to stay in the
// group. It must leave a real margin under max.poll.interval.ms: at exactly
// half, one poll that waits its full timeout plus any scheduling delay is
// enough to overshoot, and librdkafka then leaves the group (JITSU-214).
func (bc *AbstractBatchConsumer) heartbeatInterval() time.Duration {
	return time.Duration(bc.config.KafkaMaxPollIntervalMs) * time.Millisecond / 3
}

// membershipGrace is how long a consumer gets to join the group before an
// empty assignment counts as lost membership: the paused heartbeat first
// polls it after one heartbeatInterval, and joining takes up to a session.
func (bc *AbstractBatchConsumer) membershipGrace() time.Duration {
	return bc.heartbeatInterval() + time.Duration(bc.config.KafkaSessionTimeoutMs)*time.Millisecond
}

// assignmentLost reports why the current consumer no longer looks like a group
// member, or "" while it does. Only meaningful once the consumer is past the
// grace period — before that an empty assignment is just "not joined yet".
func (bc *AbstractBatchConsumer) assignmentLost(consumer *kafka.Consumer) string {
	age := time.Since(time.Unix(0, bc.consumerCreatedAt.Load()))
	if age < bc.membershipGrace() {
		return ""
	}
	partitions, err := consumer.Assignment()
	if err != nil {
		return fmt.Sprintf("assignment query failed after %s: %v", age.Round(time.Second), err)
	}
	if len(partitions) == 0 {
		return fmt.Sprintf("no partition assignment after %s while messages are waiting", age.Round(time.Second))
	}
	return ""
}

// membershipLost records that this consumer dropped out of its group — the
// condition behind topics that silently stop being consumed (JITSU-214). It is
// an error-level log and a dedicated metric label so it can be alerted on.
// Every caller follows it with a restart, which logs its own progress.
func (bc *AbstractBatchConsumer) membershipLost(reason string) {
	bc.errorMetric("membership_lost")
	bc.Errorf("Consumer group membership lost: %s", reason)
}

// onReadError handles a non-timeout error from ReadMessage during batch
// processing. A fatal error leaves the librdkafka instance permanently
// inoperable and a non-retriable one is not going to clear on its own; either
// way every later poll on this object just times out and the topic looks idle,
// so the consumer is recreated (asynchronously — the caller is inside a batch
// and holds the consumer lock).
func (bc *AbstractBatchConsumer) onReadError(kafkaErr kafka.Error) {
	bc.errorMetric("consumer_error:" + metrics.KafkaErrorCode(kafkaErr))
	if reason := membershipLossReason(kafkaErr); reason != "" {
		bc.membershipLost(reason)
	}
	if kafkaErr.IsFatal() || !kafkaErr.IsRetriable() {
		bc.restartConsumerAsync()
	}
}

// restartConsumerAsync schedules restartConsumer to run in a separate
// goroutine, returning immediately. Re-entry is suppressed: if a restart
// is already in flight, the call is a no-op. Use from contexts that must
// not block — notably the pause heartbeat loop, where a synchronous
// restartConsumer can starve the resumeChannel select for longer than
// KafkaMaxPollIntervalMs and cause "Resume timeout" in resume().
func (bc *AbstractBatchConsumer) restartConsumerAsync() {
	if !bc.restarting.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer bc.restarting.Store(false)
		bc.restartConsumer(nil)
	}()
}

// restartConsumer replaces the kafka consumer with a fresh one.
//
// The new consumer is created and published FIRST; the old one is closed
// afterwards, in quarantine (see quarantineClose). Two things make that safe:
//   - the new consumer joins under a different group.instance.id (see
//     newConsumer), so the broker never fences one static member with the
//     other — the FENCED_INSTANCE_ID fatal error that killed consumers when
//     an old member was still alive while its replacement joined (JITSU-214).
//     The old member's assignment is released by the broker once its session
//     times out, at which point the new one is assigned the partition;
//   - nothing ever closes a consumer another goroutine may still be polling:
//     the pointer swap happens before the close, and the close waits out any
//     in-flight poll.
//
// Restarts are serialized, and a consumer younger than a session timeout is
// not restarted again: whoever asked for it was looking at the previous one.
func (bc *AbstractBatchConsumer) restartConsumer(beforeInit func()) {
	if bc.retired.Load() {
		return
	}
	bc.restartMu.Lock()
	defer bc.restartMu.Unlock()
	if bc.retired.Load() {
		return
	}
	sessionTimeout := time.Duration(bc.config.KafkaSessionTimeoutMs) * time.Millisecond
	if bc.consumer.Load() != nil && time.Since(time.Unix(0, bc.consumerCreatedAt.Load())) < sessionTimeout {
		bc.Infof("Consumer was restarted less than %s ago. Skipping restart", sessionTimeout)
		//beforeInit still runs: it is the caller's own recovery work (an offset
		//fix-up via the admin client), and skipping it because someone else
		//restarted the consumer would silently drop that repair
		if beforeInit != nil {
			beforeInit()
		}
		return
	}
	bc.Infof("Restarting consumer")
	// for faster reaction on retiring
	pauseTicker := time.NewTicker(1 * time.Second)
	defer pauseTicker.Stop()
	retry := time.NewTicker(sessionTimeout + 15*time.Second)
	defer retry.Stop()
	for {
		//beforeInit runs before every attempt, as it always did: callers pass
		//idempotent work (an offset fix-up via the admin client) that must run
		//right before the consumer that will use its result
		if beforeInit != nil {
			beforeInit()
		}
		consumer, err := bc.newConsumer(true)
		if err == nil {
			//creating a consumer takes seconds; the object may have been retired
			//and closed meanwhile. Publishing now would leave a live, subscribed
			//group member nobody ever closes.
			if bc.retired.Load() && bc.idle.Load() {
				bc.Infof("Consumer was retired while restarting. Discarding the new consumer")
				_ = bc.closeConsumer(consumer)
				return
			}
			if old := bc.consumer.Swap(consumer); old != nil {
				bc.quarantineClose(old)
			}
			return
		}
		//creation failed (broker unreachable?): retry after a session timeout,
		//polling for retirement in between. Retirement alone ends the loop —
		//this runs synchronously from ConsumeAll too, where idle is false for
		//the whole run, so waiting for idle would never let a retired consumer
		//out (and it holds bc.Mutex and restartMu while it waits).
		for {
			select {
			case <-pauseTicker.C:
				if bc.retired.Load() {
					return
				}
				continue
			case <-retry.C:
			}
			break
		}
	}
}

func (bc *AbstractBatchConsumer) pauseKafkaConsumer() {
	consumer := bc.consumer.Load()
	if consumer == nil {
		//a restart is replacing the consumer; rebalanceCallback pauses the new
		//one on assignment while paused is set
		return
	}
	partitions, err := consumer.Assignment()
	if len(partitions) > 0 {
		err = consumer.Pause(partitions)
	}
	if err != nil {
		bc.errorMetric("pause_error")
		bc.SystemErrorf("Failed to pause kafka consumer: %v", err)
		bc.restartConsumer(nil)
	} else {
		if len(partitions) > 0 {
			bc.Debugf("Consumer paused.")
		}
		// otherwise rebalanceCallback will handle pausing
	}
}

func (bc *AbstractBatchConsumer) rebalanceCallback(consumer *kafka.Consumer, event kafka.Event) error {
	assignedParts, ok := event.(kafka.AssignedPartitions)
	bc.Debugf("Rebalance event: %v . Paused: %t", event, bc.paused.Load())
	if ok && bc.paused.Load() {
		err := consumer.Pause(assignedParts.Partitions)
		if err != nil {
			bc.errorMetric("pause_error")
			bc.SystemErrorf("Failed to pause kafka consumer: %v", err)
			return err
		} else {
			bc.Debugf("Consumer paused.")
		}
	}
	return nil
}

// _unpause stops the pause heartbeat for the suspend path. It sends on the
// unbuffered stopChannel so the send only completes once the heartbeat has
// received it and is leaving its loop — i.e. it is no longer inside
// ReadMessage. That rendezvous lets pauseOrSuspend close the consumer right
// after without racing the heartbeat into a non-retriable ReadMessage error
// (which would spuriously trigger restartConsumerAsync and recreate the
// consumer we intended to suspend).
func (bc *AbstractBatchConsumer) _unpause() {
	if !bc.paused.Load() {
		return
	}
	select {
	case bc.stopChannel <- struct{}{}:
		return
	case <-time.After(time.Duration(bc.config.KafkaMaxPollIntervalMs) * time.Millisecond):
		bc.errorMetric("resume_error")
		bc.SystemErrorf("failed to unpause kafka consumer.")
	}
}

func (bc *AbstractBatchConsumer) resume() {
	if !bc.paused.Load() {
		return
	}
	consumer := bc.consumer.Load()
	var err error
	defer func() {
		if err != nil {
			bc.errorMetric("resume_error")
			bc.SystemErrorf("failed to resume kafka consumer.: %v", err)
		}
	}()
	if consumer == nil {
		err = bc.NewError("no kafka consumer (restart in progress?)")
		return
	}
	partitions, err := consumer.Assignment()
	if err != nil {
		return
	}
	select {
	case bc.resumeChannel <- struct{}{}:
		err = consumer.Resume(partitions)
	case <-time.After(time.Duration(bc.config.KafkaMaxPollIntervalMs) * time.Millisecond):
		err = bc.NewError("Resume timeout.")
		//return bc.consumer.Resume(partitions)
	}
}

// Retire Mark consumer as retired
// Consumer will close itself when com
func (bc *AbstractBatchConsumer) Retire() {
	bc.Infof("Retiring %s consumer", bc.mode)
	bc.retired.Store(true)
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

// hasLag reports whether the topic holds messages this consumer has not
// committed: either nothing was ever committed (OffsetBeginning/invalid) or the
// committed offset trails the high watermark.
func hasLag(committedOffset, highOffset int64) bool {
	if highOffset <= 0 {
		return false
	}
	return committedOffset < 0 || committedOffset < highOffset
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
