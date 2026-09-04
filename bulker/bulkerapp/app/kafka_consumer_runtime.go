package app

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

const (
	maxConsumerControlPollInterval = 10 * time.Second
	consumerAssignmentPollInterval = time.Second
	consumerReconnectMaxBackoff    = 30 * time.Second
)

var (
	errConsumerRuntimeClosed     = errors.New("kafka consumer runtime is closed")
	errConsumerNotStarted        = errors.New("kafka consumer is not started")
	errConsumerAssignmentChanged = errors.New("kafka consumer assignment changed")
)

// groupConsumer is the part of kafka.Consumer used by the runtime. Keeping the
// boundary here makes the group state machine testable without a broker.
type groupConsumer interface {
	SubscribeTopics([]string, kafka.RebalanceCb) error
	Poll(int) kafka.Event
	Assign([]kafka.TopicPartition) error
	Unassign() error
	IncrementalAssign([]kafka.TopicPartition) error
	IncrementalUnassign([]kafka.TopicPartition) error
	GetRebalanceProtocol() string
	Assignment() ([]kafka.TopicPartition, error)
	AssignmentLost() bool
	Pause([]kafka.TopicPartition) error
	Resume([]kafka.TopicPartition) error
	QueryWatermarkOffsets(string, int32, int) (int64, int64, error)
	Committed([]kafka.TopicPartition, int) ([]kafka.TopicPartition, error)
	SeekPartitions([]kafka.TopicPartition) ([]kafka.TopicPartition, error)
	CommitMessage(*kafka.Message) ([]kafka.TopicPartition, error)
	GetConsumerGroupMetadata() (*kafka.ConsumerGroupMetadata, error)
	Unsubscribe() error
	Close() error
	String() string
}

type groupConsumerFactory func(*kafka.ConfigMap) (groupConsumer, error)

type consumerRuntimeHooks struct {
	debugf       func(string, ...any)
	infof        func(string, ...any)
	errorf       func(string, ...any)
	onKafkaError func(kafka.Error)
}

type consumerCommand struct {
	run  func(*consumerSession)
	done chan struct{}
}

// consumerRuntime serializes every operation on a Kafka consumer through one
// owner goroutine. Slow destination work never receives the raw consumer; it
// can only submit commands carrying the assignment epoch it read under.
type consumerRuntime struct {
	config              kafka.ConfigMap
	topic               string
	factory             groupConsumerFactory
	hooks               consumerRuntimeHooks
	maintenanceInterval time.Duration

	commands  chan consumerCommand
	stop      chan struct{}
	done      chan struct{}
	startOnce sync.Once
	stopOnce  sync.Once
	closeErr  error
}

type consumerSession struct {
	runtime *consumerRuntime

	consumer groupConsumer
	wanted   bool
	//pauseRequested is the desired state. Keep it separate from pauseApplied
	//so a failed Pause does not also disable the maintenance polls that retry it.
	pauseRequested bool
	pauseApplied   bool
	epoch          uint64
	pending        []*kafka.Message
	rebalanceErr   error
	rebalanceLost  bool
	closing        bool

	reconnectAt      time.Time
	reconnectBackoff time.Duration
}

func newConsumerRuntime(config kafka.ConfigMap, topic string, hooks consumerRuntimeHooks, maxPollInterval time.Duration) *consumerRuntime {
	return newConsumerRuntimeWithFactory(config, topic, hooks, func(config *kafka.ConfigMap) (groupConsumer, error) {
		return kafka.NewConsumer(config)
	}, consumerMaintenanceInterval(maxPollInterval))
}

func newConsumerRuntimeWithFactory(config kafka.ConfigMap, topic string, hooks consumerRuntimeHooks, factory groupConsumerFactory, maintenanceInterval time.Duration) *consumerRuntime {
	runtime := &consumerRuntime{
		config:              config,
		topic:               topic,
		factory:             factory,
		hooks:               hooks,
		maintenanceInterval: maintenanceInterval,
		commands:            make(chan consumerCommand),
		stop:                make(chan struct{}),
		done:                make(chan struct{}),
	}
	return runtime
}

func consumerMaintenanceInterval(maxPollInterval time.Duration) time.Duration {
	interval := maxPollInterval / 4
	if interval <= 0 || interval > maxConsumerControlPollInterval {
		return maxConsumerControlPollInterval
	}
	return interval
}

func (runtime *consumerRuntime) start() {
	runtime.startOnce.Do(func() { go runtime.run() })
}

func (runtime *consumerRuntime) run() {
	ticker := time.NewTicker(runtime.maintenanceInterval)
	defer ticker.Stop()
	defer close(runtime.done)

	session := &consumerSession{runtime: runtime}
	for {
		select {
		case command := <-runtime.commands:
			command.run(session)
			close(command.done)
		case <-ticker.C:
			session.maintain()
		case <-runtime.stop:
			session.wanted = false
			runtime.closeErr = session.closeCurrent()
			return
		}
	}
}

func (runtime *consumerRuntime) execute(run func(*consumerSession)) error {
	runtime.start()
	command := consumerCommand{run: run, done: make(chan struct{})}
	select {
	case runtime.commands <- command:
	case <-runtime.done:
		return errConsumerRuntimeClosed
	}
	select {
	case <-command.done:
		return nil
	case <-runtime.done:
		return errConsumerRuntimeClosed
	}
}

func (runtime *consumerRuntime) init() (created bool, err error) {
	err = runtime.execute(func(session *consumerSession) {
		session.wanted = true
		if session.consumer != nil {
			return
		}
		created = true
		err = session.open()
	})
	return
}

func (runtime *consumerRuntime) assignment(wait time.Duration) (partitions []kafka.TopicPartition, epoch uint64, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if session.consumer == nil {
			err = errConsumerNotStarted
			return
		}
		deadline := time.Now().Add(wait)
		for {
			select {
			case <-session.runtime.stop:
				err = errConsumerRuntimeClosed
				epoch = session.epoch
				return
			default:
			}
			partitions, err = session.consumer.Assignment()
			if err != nil || len(partitions) > 0 || wait <= 0 || !time.Now().Before(deadline) {
				epoch = session.epoch
				return
			}
			remaining := time.Until(deadline)
			if remaining > consumerAssignmentPollInterval {
				remaining = consumerAssignmentPollInterval
			}
			message, pollErr := session.poll(remaining)
			if message != nil {
				session.pending = append(session.pending, message)
			}
			if pollErr != nil && !isKafkaTimeout(pollErr) {
				err = pollErr
				epoch = session.epoch
				return
			}
		}
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) readMessage(timeout time.Duration, expectedEpoch uint64) (message *kafka.Message, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		if len(session.pending) > 0 {
			message = session.pending[0]
			session.pending = session.pending[1:]
			return
		}
		message, err = session.poll(timeout)
		if epochErr := session.validateEpoch(expectedEpoch); epochErr != nil {
			if message != nil {
				session.pending = append([]*kafka.Message{message}, session.pending...)
				message = nil
			}
			err = epochErr
		}
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) queryWatermarkOffsets(topic string, partition int32, timeoutMs int, expectedEpoch uint64) (low, high int64, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		low, high, err = session.consumer.QueryWatermarkOffsets(topic, partition, timeoutMs)
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) committed(partitions []kafka.TopicPartition, timeoutMs int, expectedEpoch uint64) (offsets []kafka.TopicPartition, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		offsets, err = session.consumer.Committed(partitions, timeoutMs)
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) seekPartitions(partitions []kafka.TopicPartition, expectedEpoch uint64) (result []kafka.TopicPartition, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		result, err = session.consumer.SeekPartitions(partitions)
		if err == nil {
			session.discardPending(result)
		}
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) commitMessage(message *kafka.Message, expectedEpoch uint64) (result []kafka.TopicPartition, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		result, err = session.consumer.CommitMessage(message)
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) groupMetadata(expectedEpoch uint64) (metadata *kafka.ConsumerGroupMetadata, err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		if err = session.validateEpoch(expectedEpoch); err != nil {
			return
		}
		metadata, err = session.consumer.GetConsumerGroupMetadata()
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) pause() (err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		err = session.setPaused(true)
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) resume() (err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		err = session.setPaused(false)
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) suspend() (err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		session.wanted = false
		session.pauseRequested = false
		err = session.closeCurrent()
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) restart(beforeOpen func()) (err error) {
	executeErr := runtime.execute(func(session *consumerSession) {
		session.wanted = true
		if closeErr := session.closeCurrent(); closeErr != nil {
			runtime.hooks.errorf("Failed to close Kafka consumer before restart: %v", closeErr)
		}
		if beforeOpen != nil {
			beforeOpen()
		}
		err = session.open()
	})
	if executeErr != nil {
		err = executeErr
	}
	return
}

func (runtime *consumerRuntime) description() string {
	description := "not started"
	_ = runtime.execute(func(session *consumerSession) {
		if session.consumer != nil {
			description = session.consumer.String()
		}
	})
	return description
}

func (runtime *consumerRuntime) close() error {
	runtime.start()
	runtime.stopOnce.Do(func() { close(runtime.stop) })
	<-runtime.done
	return runtime.closeErr
}

func (session *consumerSession) open() error {
	if session.consumer != nil {
		return nil
	}
	consumer, err := session.runtime.factory(&session.runtime.config)
	if err != nil {
		session.scheduleReconnect()
		return err
	}
	if err = consumer.SubscribeTopics([]string{session.runtime.topic}, func(_ *kafka.Consumer, event kafka.Event) error {
		if session.closing {
			return nil
		}
		session.rebalanceLost, session.rebalanceErr = session.handleRebalance(event)
		return session.rebalanceErr
	}); err != nil {
		_ = consumer.Close()
		session.scheduleReconnect()
		return err
	}
	session.consumer = consumer
	session.pauseApplied = false
	session.pending = nil
	session.reconnectAt = time.Time{}
	session.reconnectBackoff = 0
	session.runtime.hooks.infof("Consumer created: %s", consumer.String())
	return nil
}

func (session *consumerSession) closeCurrent() error {
	consumer := session.consumer
	if consumer == nil {
		return nil
	}
	description := consumer.String()
	session.closing = true
	session.consumer = nil
	session.pending = nil
	session.pauseApplied = false
	session.epoch++
	unsubscribeErr := consumer.Unsubscribe()
	closeErr := consumer.Close()
	session.closing = false
	session.rebalanceLost, session.rebalanceErr = false, nil
	session.runtime.hooks.infof("Consumer closed: %s unsubscribe: %v close: %v", description, unsubscribeErr, closeErr)
	return closeErr
}

func (session *consumerSession) maintain() {
	if session.consumer == nil {
		if session.wanted && (session.reconnectAt.IsZero() || !time.Now().Before(session.reconnectAt)) {
			if err := session.open(); err != nil {
				session.runtime.hooks.errorf("Failed to recreate Kafka consumer: %v", err)
			}
		}
		return
	}
	if !session.pauseRequested {
		return
	}
	if !session.pauseApplied {
		if err := session.applyPause(); err != nil {
			session.runtime.hooks.errorf("Failed to pause Kafka consumer during maintenance: %v", err)
		}
	}
	message, err := session.poll(0)
	if message != nil {
		session.pending = append(session.pending, message)
	}
	if err != nil && !isKafkaTimeout(err) {
		session.runtime.hooks.errorf("Error while polling paused Kafka consumer: %v", err)
	}
}

func (session *consumerSession) poll(timeout time.Duration) (*kafka.Message, error) {
	if session.consumer == nil {
		return nil, errConsumerNotStarted
	}
	deadline := time.Now().Add(timeout)
	for {
		timeoutMs := int(timeout / time.Millisecond)
		if timeout > 0 {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return nil, kafka.NewError(kafka.ErrTimedOut, "consumer poll timed out", false)
			}
			timeoutMs = int(remaining / time.Millisecond)
			if timeoutMs == 0 {
				timeoutMs = 1
			}
		}
		event := session.consumer.Poll(timeoutMs)
		rebalanceLost, rebalanceErr := session.rebalanceLost, session.rebalanceErr
		session.rebalanceLost, session.rebalanceErr = false, nil
		if rebalanceLost || rebalanceErr != nil {
			if err := session.recreate(); err != nil {
				session.runtime.hooks.errorf("Failed to recreate Kafka consumer after rebalance failure: %v", err)
			}
			if rebalanceErr != nil {
				return nil, fmt.Errorf("failed to apply Kafka rebalance: %w", rebalanceErr)
			}
			return nil, errConsumerAssignmentChanged
		}
		switch value := event.(type) {
		case *kafka.Message:
			if value.TopicPartition.Error != nil {
				var kafkaErr kafka.Error
				if errors.As(value.TopicPartition.Error, &kafkaErr) {
					session.handleKafkaError(kafkaErr)
				}
				return nil, value.TopicPartition.Error
			}
			return value, nil
		case kafka.AssignedPartitions:
			lost, err := session.handleRebalance(value)
			if err != nil || lost {
				if recreateErr := session.recreate(); recreateErr != nil {
					session.runtime.hooks.errorf("Failed to recreate Kafka consumer after rebalance failure: %v", recreateErr)
				}
				if err != nil {
					return nil, fmt.Errorf("failed to apply Kafka rebalance: %w", err)
				}
				return nil, errConsumerAssignmentChanged
			}
		case kafka.RevokedPartitions:
			lost, err := session.handleRebalance(value)
			if err != nil || lost {
				if recreateErr := session.recreate(); recreateErr != nil {
					session.runtime.hooks.errorf("Failed to recreate Kafka consumer after rebalance failure: %v", recreateErr)
				}
				if err != nil {
					return nil, fmt.Errorf("failed to apply Kafka rebalance: %w", err)
				}
				return nil, errConsumerAssignmentChanged
			}
		case kafka.Error:
			session.handleKafkaError(value)
			return nil, value
		case nil:
			return nil, kafka.NewError(kafka.ErrTimedOut, "consumer poll timed out", false)
		}
		if timeout == 0 {
			return nil, nil
		}
	}
}

func (session *consumerSession) handleKafkaError(kafkaErr kafka.Error) {
	session.runtime.hooks.onKafkaError(kafkaErr)
	if shouldRecreateConsumer(kafkaErr) {
		if err := session.recreate(); err != nil {
			session.runtime.hooks.errorf("Failed to recreate Kafka consumer: %v", err)
		}
	}
}

func (session *consumerSession) handleRebalance(event kafka.Event) (lost bool, err error) {
	switch value := event.(type) {
	case kafka.AssignedPartitions:
		err = session.onAssigned(value.Partitions)
	case kafka.RevokedPartitions:
		lost, err = session.onRevoked(value.Partitions)
	default:
		err = fmt.Errorf("unexpected Kafka rebalance event: %T", event)
	}
	return
}

func (session *consumerSession) onAssigned(partitions []kafka.TopicPartition) error {
	session.epoch++
	session.pending = nil
	var err error
	if session.consumer.GetRebalanceProtocol() == "COOPERATIVE" {
		err = session.consumer.IncrementalAssign(partitions)
	} else {
		err = session.consumer.Assign(partitions)
	}
	if err != nil {
		return err
	}
	session.pauseApplied = false
	if session.pauseRequested && len(partitions) > 0 {
		if err := session.consumer.Pause(partitions); err != nil {
			return err
		}
		session.pauseApplied = true
	}
	session.runtime.hooks.debugf("Consumer assigned partitions at epoch %d: %v", session.epoch, partitions)
	return nil
}

func (session *consumerSession) onRevoked(partitions []kafka.TopicPartition) (lost bool, err error) {
	lost = session.consumer.AssignmentLost()
	session.epoch++
	session.pending = nil
	if session.consumer.GetRebalanceProtocol() == "COOPERATIVE" {
		err = session.consumer.IncrementalUnassign(partitions)
	} else {
		err = session.consumer.Unassign()
	}
	if err != nil {
		session.runtime.hooks.errorf("Failed to unassign revoked partitions: %v", err)
	}
	session.pauseApplied = false
	if lost {
		session.runtime.hooks.onKafkaError(kafka.NewError(kafka.ErrUnknownMemberID, "partition assignment lost during rebalance", false))
	}
	session.runtime.hooks.debugf("Consumer revoked partitions at epoch %d: %v", session.epoch, partitions)
	return
}

func (session *consumerSession) setPaused(paused bool) error {
	if session.consumer == nil {
		return errConsumerNotStarted
	}
	if session.pauseRequested == paused && session.pauseApplied == paused {
		return nil
	}
	session.pauseRequested = paused
	if paused {
		return session.applyPause()
	}
	partitions, err := session.consumer.Assignment()
	if err != nil {
		return err
	}
	if len(partitions) > 0 {
		if err = session.consumer.Resume(partitions); err != nil {
			return err
		}
	}
	session.pauseApplied = false
	return nil
}

func (session *consumerSession) applyPause() error {
	partitions, err := session.consumer.Assignment()
	if err != nil {
		return err
	}
	if len(partitions) == 0 {
		session.pauseApplied = false
		return nil
	}
	if err = session.consumer.Pause(partitions); err != nil {
		return err
	}
	session.pauseApplied = true
	return nil
}

func (session *consumerSession) discardPending(partitions []kafka.TopicPartition) {
	type partitionKey struct {
		topic     string
		partition int32
	}
	targets := make(map[partitionKey]struct{}, len(partitions))
	for _, partition := range partitions {
		if partition.Error == nil && partition.Topic != nil {
			targets[partitionKey{topic: *partition.Topic, partition: partition.Partition}] = struct{}{}
		}
	}
	kept := session.pending[:0]
	for _, message := range session.pending {
		if message == nil || message.TopicPartition.Topic == nil {
			kept = append(kept, message)
			continue
		}
		key := partitionKey{topic: *message.TopicPartition.Topic, partition: message.TopicPartition.Partition}
		if _, discard := targets[key]; !discard {
			kept = append(kept, message)
		}
	}
	session.pending = kept
}

func (session *consumerSession) validateEpoch(expected uint64) error {
	if session.consumer == nil {
		return errConsumerNotStarted
	}
	if expected != session.epoch {
		return fmt.Errorf("%w: expected epoch %d, current epoch %d", errConsumerAssignmentChanged, expected, session.epoch)
	}
	return nil
}

func (session *consumerSession) recreate() error {
	session.wanted = true
	if err := session.closeCurrent(); err != nil {
		session.runtime.hooks.errorf("Failed to close unusable Kafka consumer: %v", err)
	}
	return session.open()
}

func (session *consumerSession) scheduleReconnect() {
	if session.reconnectBackoff == 0 {
		session.reconnectBackoff = time.Second
	} else {
		session.reconnectBackoff *= 2
		if session.reconnectBackoff > consumerReconnectMaxBackoff {
			session.reconnectBackoff = consumerReconnectMaxBackoff
		}
	}
	session.reconnectAt = time.Now().Add(session.reconnectBackoff)
}

func shouldRecreateConsumer(kafkaErr kafka.Error) bool {
	return kafkaErr.Code() != kafka.ErrTimedOut && (kafkaErr.IsFatal() || !kafkaErr.IsRetriable())
}

func isKafkaTimeout(err error) bool {
	var kafkaErr kafka.Error
	return errors.As(err, &kafkaErr) && kafkaErr.Code() == kafka.ErrTimedOut
}
