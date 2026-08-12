package app

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
)

const streamConsumerMessageWaitTimeout = 5 * time.Second

type StreamConsumerImpl struct {
	*AbstractConsumer
	repository     *Repository
	destination    *Destination
	retryTopic     string
	stream         atomic.Pointer[StreamWrapper]
	consumerConfig kafka.ConfigMap
	consumer       *kafka.Consumer

	eventsLogService eventslog.EventsLogService

	tableName     string
	currentOffset int64
	closed        chan struct{}
}

type StreamConsumer interface {
	Consumer
	UpdateDestination(destination *Destination) error
}

func NewStreamConsumer(repository *Repository, destination *Destination, topicId string, config *Config, kafkaConfig *kafka.ConfigMap, bulkerProducer *Producer, eventsLogService eventslog.EventsLogService, topicManager *TopicManager) (*StreamConsumerImpl, error) {
	abstract := NewAbstractConsumer(config, repository, topicId, bulkerProducer, topicManager)
	_, _, tableName, err := ParseTopicId(topicId)
	if err != nil {
		metrics.ConsumerErrors(topicId, "stream", "INVALID_TOPIC", "INVALID_TOPIC:"+topicId, "failed to parse topic").Inc()
		return nil, abstract.NewError("Failed to parse topic: %v", err)
	}
	consumerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
		"group.id":                      topicId,
		"auto.offset.reset":             "earliest",
		"allow.auto.create.topics":      false,
		"group.instance.id":             abstract.GetInstanceId(),
		"partition.assignment.strategy": config.KafkaConsumerPartitionsAssigmentStrategy,
		"enable.auto.commit":            true,
		"isolation.level":               "read_committed",
		"session.timeout.ms":            config.KafkaSessionTimeoutMs,
		"max.poll.interval.ms":          config.KafkaMaxPollIntervalMs,
	}, *kafkaConfig))

	consumer, err := kafka.NewConsumer(&consumerConfig)
	if err != nil {
		metrics.ConsumerErrors(topicId, "stream", destination.Id(), tableName, metrics.KafkaErrorCode(err)).Inc()
		return nil, abstract.NewError("Error creating kafka consumer: %v", err)
	}

	err = consumer.SubscribeTopics([]string{topicId}, nil)
	if err != nil {
		_ = consumer.Close()
		metrics.ConsumerErrors(topicId, "stream", destination.Id(), tableName, metrics.KafkaErrorCode(err)).Inc()
		return nil, abstract.NewError("Failed to subscribe to topic: %v", err)
	}

	//destination := repository.LeaseDestination(destinationId)
	//if destination == nil {
	//	return nil, fmt.Errorf("[%s] Destination not found", destinationId)
	//}
	retryTopic, _ := MakeTopicId(destination.Id(), retryTopicMode, allTablesToken, config.KafkaTopicPrefix, 0, false)

	sc := &StreamConsumerImpl{
		AbstractConsumer: abstract,
		repository:       repository,
		destination:      destination,
		retryTopic:       retryTopic,
		tableName:        tableName,
		consumerConfig:   consumerConfig,
		consumer:         consumer,
		eventsLogService: eventsLogService,
		closed:           make(chan struct{}),
	}
	sc.stream.Store(&StreamWrapper{destination: destination, topicId: topicId, tableName: tableName})
	sc.start()
	return sc, nil
}

type StreamWrapper struct {
	destination *Destination
	stream      bulker.BulkerStream
	topicId     string
	tableName   string
}

func (sw *StreamWrapper) Consume(ctx context.Context, message *kafka.Message) (state bulker.State, processedObject types.Object, err error) {
	if sw.stream == nil {
		sw.destination.Lease()
		sw.destination.InitBulkerInstance()
		streamOptions := sw.destination.streamOptions.Options
		opts, err1 := kafkabase.GetKafkaObjectHeader(message, streamOptionsKeyHeader)
		if err1 != nil {
			logging.Infof("%v", err1)
		}
		if len(opts) > 0 {
			streamOptions = make([]bulker.StreamOption, 0, len(streamOptions)+2)
			streamOptions = append(streamOptions, sw.destination.streamOptions.Options...)
			for name, serializedOption := range opts {
				opt, err2 := bulker.ParseOption(name, serializedOption)
				if err2 != nil {
					logging.Infof("Failed to parse stream option: %s=%s: %v", name, serializedOption, err2)
					continue
				}
				streamOptions = append(streamOptions, opt)
			}
		}
		bulkerStream, err := sw.destination.bulker.CreateStream(sw.topicId, sw.tableName, bulker.Stream, streamOptions...)
		if err != nil {
			metrics.ConsumerErrors(sw.topicId, "stream", sw.destination.Id(), sw.tableName, "failed to create bulker stream").Inc()
			return bulker.State{}, nil, fmt.Errorf("Failed to create bulker stream: %v", err)
		}
		sw.stream = bulkerStream
	}
	return sw.stream.ConsumeJSON(ctx, message.Value)
}

func (sw *StreamWrapper) Abort(ctx context.Context) bulker.State {
	if sw.stream == nil {
		return bulker.State{}
	}
	sw.destination.Release()
	return sw.stream.Abort(ctx)
}

func (sw *StreamWrapper) Complete(ctx context.Context) (bulker.State, error) {
	if sw.stream == nil {
		return bulker.State{}, nil
	}
	sw.destination.Release()
	return sw.stream.Complete(ctx)
}

func (sc *StreamConsumerImpl) restartConsumer() {
	sc.Infof("Restarting consumer")
	go func(c *kafka.Consumer) {
		err := c.Close()
		sc.Infof("Previous consumer closed: %v", err)
	}(sc.consumer)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-sc.closed:
			return
		case <-ticker.C:
			sc.Infof("Restarting consumer")
			consumer, err := kafka.NewConsumer(&sc.consumerConfig)
			if err != nil {
				metrics.ConsumerErrors(sc.topicId, "stream", sc.destination.Id(), sc.tableName, metrics.KafkaErrorCode(err)).Inc()
				sc.Errorf("Error creating kafka consumer: %v", err)
				break
			}
			err = consumer.SubscribeTopics([]string{sc.topicId}, nil)
			if err != nil {
				metrics.ConsumerErrors(sc.topicId, "stream", sc.destination.Id(), sc.tableName, metrics.KafkaErrorCode(err)).Inc()
				_ = consumer.Close()
				sc.Errorf("Failed to subscribe to topic: %v", err)
				break
			}
			sc.consumer = consumer
			sc.Infof("Restarted successfully")
			return
		}
	}
}

// start consuming messages from kafka
func (sc *StreamConsumerImpl) start() {
	sc.Infof("Starting stream consumer for topic. Ver: %s", sc.destination.config.UpdatedAt)
	safego.RunWithRestart(func() {
		var err error
		var queueSize float64
		lastCurrentOffset := sc.currentOffset
		speedMeasurementInterval := 10 * time.Second
		var processedPerInterval int
		var speed float64
		queueSizeTicker := time.NewTicker(1 * time.Minute)
		defer queueSizeTicker.Stop()
		speedTicker := time.NewTicker(speedMeasurementInterval)
		defer speedTicker.Stop()
		for {
			select {
			case <-sc.closed:
				_ = sc.consumer.Close()
				var state bulker.State
				if err != nil {
					state = sc.stream.Load().Abort(context.Background())
				} else {
					state, _ = sc.stream.Load().Complete(context.Background())
				}
				sc.Infof("Closed stream state: %+v", state)
				return
			case <-speedTicker.C:
				speed = float64(processedPerInterval) / speedMeasurementInterval.Seconds()
				processedPerInterval = 0
			case <-queueSizeTicker.C:
				if sc.currentOffset != lastCurrentOffset {
					lastCurrentOffset = sc.currentOffset
					_, highOffset, err := sc.consumer.QueryWatermarkOffsets(sc.topicId, 0, 10_000)
					if err != nil {
						sc.Errorf("Error querying watermark offsets: %v", err)
						metrics.ConsumerErrors(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "query_watermark_failed").Inc()
					} else {
						queueSize = math.Max(float64(highOffset-sc.currentOffset-2), 0)
						metrics.ConsumerQueueSize(sc.topicId, "stream", sc.destination.Id(), sc.tableName).Set(queueSize)
					}
				}
			default:
				var message *kafka.Message
				message, err = sc.consumer.ReadMessage(streamConsumerMessageWaitTimeout)
				if err != nil {
					kafkaErr := err.(kafka.Error)
					if kafkaErr.Code() != kafka.ErrTimedOut {
						metrics.ConsumerErrors(sc.topicId, "stream", sc.destination.Id(), sc.tableName, metrics.KafkaErrorCode(kafkaErr)).Inc()
						sc.Errorf("Error reading message from topic: %v retryable: %t", kafkaErr, kafkaErr.IsRetriable())
						if kafkaErr.IsRetriable() {
							time.Sleep(10 * time.Second)
						} else {
							sc.restartConsumer()
						}
					} else {
						time.Sleep(streamConsumerMessageWaitTimeout)
					}
					continue
				}
				sc.currentOffset = int64(message.TopicPartition.Offset)
				metricsMeta := kafkabase.GetKafkaHeader(message, MetricsMetaHeader)
				metrics.ConsumerMessages(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "consumed").Inc()
				retries, _ := kafkabase.GetKafkaIntHeader(message, retriesCountHeader)
				if retries > 0 {
					metrics.ConnectionMessageStatuses(sc.destination.Id(), sc.tableName, "retried").Inc()
				}
				var state bulker.State
				var processedObject types.Object
				state, processedObject, err = sc.stream.Load().Consume(context.Background(), message)
				processedPerInterval++
				queueSize--
				sc.postEventsLog(message.Value, MessageIdFromMetricsMeta(metricsMeta), state.Representation, processedObject, queueSize, speed, err)
				if err != nil {
					metrics.ConsumerErrors(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "bulker_stream_error").Inc()
					sc.Errorf("Failed to inject event to bulker stream: %v", err)
				} else {
					sc.SendMetrics(metricsMeta, "success", 1)
					metrics.ConnectionMessageStatuses(sc.destination.Id(), sc.tableName, "success").Inc()
					metrics.ConsumerMessages(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "processed").Inc()
				}

				if err != nil {
					originalError := err
					failedTopic := sc.retryTopic
					metricStatus := "error"
					if retries > 0 {
						metricStatus = "retry_error"
					}
					sc.SendMetrics(metricsMeta, metricStatus, 1)
					status := "retryScheduled"
					metrics.ConnectionMessageStatuses(sc.destination.Id(), sc.tableName, "error").Inc()
					if retries >= sc.config.MessagesRetryCount {
						//no attempts left - send to dead-letter topic
						status = "deadLettered"
						metrics.ConnectionMessageStatuses(sc.destination.Id(), sc.tableName, "deadLettered").Inc()
						failedTopic = sc.config.KafkaDestinationsDeadLetterTopicName
					} else {
						err = sc.topicManager.ensureTopic(sc.retryTopic, 1, sc.topicManager.RetryTopicConfig())
						if err != nil {
							sc.Errorf("failed to create retry topic %s: %v", sc.retryTopic, err)
						}
					}
					headers := message.Headers
					kafkabase.PutKafkaHeader(&headers, errorHeader, utils.ShortenStringWithEllipsis(originalError.Error(), 256))
					kafkabase.PutKafkaHeader(&headers, originalTopicHeader, sc.topicId)
					kafkabase.PutKafkaHeader(&headers, retriesCountHeader, strconv.Itoa(retries))
					kafkabase.PutKafkaHeader(&headers, retryTimeHeader, timestamp.ToISOFormat(RetryBackOffTime(sc.config, retries+1).UTC()))
					retryMessage := kafka.Message{
						Key:            message.Key,
						TopicPartition: kafka.TopicPartition{Topic: &failedTopic, Partition: kafka.PartitionAny},
						Headers:        headers,
						Value:          message.Value,
					}
					err = sc.bulkerProducer.ProduceSync(failedTopic, retryMessage)
					if err != nil {
						sc.Errorf("failed to store event to 'failed' topic: %s: %v", failedTopic, err)
						metrics.ConsumerMessages(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "LOST").Inc()
						continue
					}
					metrics.ConsumerMessages(sc.topicId, "stream", sc.destination.Id(), sc.tableName, "failed").Inc()
					metrics.ConsumerMessages(sc.topicId, "stream", sc.destination.Id(), sc.tableName, status).Inc()
				}

			}
		}
	})
}

func (sc *StreamConsumerImpl) TopicId() string {
	return sc.topicId
}

// Close consumer
func (sc *StreamConsumerImpl) Retire() {
	select {
	case <-sc.closed:
		return
	default:
	}
	sc.Infof("Closing stream consumer. Ver: %s", sc.destination.config.UpdatedAt)
	close(sc.closed)
	sc.destination.Release()
	//TODO: wait for closing?
	return
}

// UpdateDestination
func (sc *StreamConsumerImpl) UpdateDestination(destination *Destination) error {
	sc.Infof("[Updating stream consumer for topic. Ver: %s", sc.destination.config.UpdatedAt)

	//create new stream
	oldBulkerStream := sc.stream.Swap(&StreamWrapper{destination: destination, topicId: sc.topicId, tableName: sc.tableName})
	state, _ := (*oldBulkerStream).Complete(context.Background())
	sc.Infof("Previous stream state: %+v", state)
	sc.destination = destination
	return nil
}

func (sc *StreamConsumerImpl) postEventsLog(message []byte, messageId string, representation any, processedObject types.Object, queueSize float64, speed float64, processedErr error) {
	object := map[string]any{
		"original":  string(message),
		"status":    "SUCCESS",
		"queueSize": max(int(queueSize), 0),
		"speed":     speed,
	}
	if representation != nil {
		object["representation"] = representation
	}
	if processedObject.Len() > 0 {
		object["mappedData"] = processedObject
	}

	level := eventslog.LevelInfo
	if processedErr != nil {
		object["error"] = processedErr.Error()
		object["status"] = "FAILED"
		level = eventslog.LevelError
	}
	sc.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeProcessed, Level: level, ActorId: sc.destination.Id(), WorkspaceId: sc.destination.WorkspaceId(), MessageId: messageId, Event: object})
}
