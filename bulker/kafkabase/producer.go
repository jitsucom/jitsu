package kafkabase

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

const MessageIdHeader = "message_id"

// ProduceWithBackpressure submits msg via producer.Produce, retrying on
// kafka.ErrQueueFull until the outbound queue drains or maxWait elapses.
// ErrQueueFull is a transient back-pressure signal from librdkafka, not a
// fatal error; Flush blocks (bounded) while in-flight messages get sent to
// the broker and free queue slots. flushTimeoutMs is the per-iteration Flush
// wait; maxWait caps total wall-clock time before giving up. Any non-queue-full
// error is returned verbatim; a deadline-exceeded queue-full is wrapped.
func ProduceWithBackpressure(producer *kafka.Producer, msg *kafka.Message, flushTimeoutMs int, maxWait time.Duration) error {
	if flushTimeoutMs < 10 {
		flushTimeoutMs = 10
	}
	deadline := time.Now().Add(maxWait)
	for {
		err := producer.Produce(msg, nil)
		if err == nil {
			return nil
		}
		var kerr kafka.Error
		if errors.As(err, &kerr) && kerr.Code() == kafka.ErrQueueFull {
			if time.Now().After(deadline) {
				return fmt.Errorf("producer queue still full after %s: %w", maxWait, err)
			}
			producer.Flush(flushTimeoutMs)
			continue
		}
		return err
	}
}

type MetricsLabelsFunc func(topicId string, status, errText string) (topic, destinationId, mode, tableName, st string, err string)

type PartitionSelector interface {
	SelectPartition() int32
}

type DummyPartitionSelector struct {
}

func (dps *DummyPartitionSelector) SelectPartition() int32 {
	return kafka.PartitionAny

}

type Producer struct {
	appbase.Service
	producer             *kafka.Producer
	config               *KafkaConfig
	reportQueueLength    bool
	asyncDeliveryChannel chan kafka.Event
	waitForDelivery      time.Duration
	closed               atomic.Bool
	metricsLabelFunc     MetricsLabelsFunc
	failoverLogger       *FailoverLogger

	// previous cumulative values from librdkafka stats for delta computation
	prevTxMsgs     float64
	prevTxMsgBytes float64
	prevTx         float64
	prevTxBytes    float64
}

// producerStats represents a subset of librdkafka statistics JSON
type producerStats struct {
	MsgCnt     float64                `json:"msg_cnt"`
	MsgSize    float64                `json:"msg_size"`
	TxMsgs     float64                `json:"txmsgs"`
	TxMsgBytes float64                `json:"txmsg_bytes"`
	Tx         float64                `json:"tx"`
	TxBytes    float64                `json:"tx_bytes"`
	Brokers    map[string]brokerStats `json:"brokers"`
}

type brokerStats struct {
	Name        string   `json:"name"`
	Nodeid      int      `json:"nodeid"`
	State       string   `json:"state"`
	OutbufCnt   float64  `json:"outbuf_cnt"`
	WaitrespCnt float64  `json:"waitresp_cnt"`
	Rtt         rttStats `json:"rtt"`
}

type rttStats struct {
	Avg float64 `json:"avg"`
}

// NewProducer creates new Producer
func NewProducer(config *KafkaConfig, kafkaConfig *kafka.ConfigMap, reportQueueLength bool, metricsLabelFunc MetricsLabelsFunc) (*Producer, error) {
	base := appbase.NewServiceBase("producer")
	if config.ProducerStatisticsIntervalMs > 0 {
		_ = kafkaConfig.SetKey("statistics.interval.ms", config.ProducerStatisticsIntervalMs)
	}
	producer, err := kafka.NewProducer(kafkaConfig)
	if err != nil {
		return nil, base.NewError("error creating kafka producer: %v", err)

	}
	if metricsLabelFunc == nil {
		metricsLabelFunc = defaultMetricsLabelFunc
	}

	// Create failover logger if configured
	var failoverLogger *FailoverLogger
	if config.FailoverLoggerEnabled {
		failoverConfig, err := config.FailoverLoggerEnvConfig.ToFailoverLoggerConfig()
		if err != nil {
			return nil, base.NewError("error converting failover logger config: %v", err)
		}
		if failoverConfig != nil {
			failoverLogger, err = NewFailoverLogger(failoverConfig)
			if err != nil {
				return nil, base.NewError("error creating failover logger: %v", err)
			}
		}
	}

	return &Producer{
		Service:              base,
		producer:             producer,
		config:               config,
		reportQueueLength:    reportQueueLength,
		asyncDeliveryChannel: make(chan kafka.Event, 1000),
		waitForDelivery:      time.Millisecond * time.Duration(config.ProducerWaitForDeliveryMs),
		metricsLabelFunc:     metricsLabelFunc,
		failoverLogger:       failoverLogger,
	}, nil
}

func (p *Producer) Start() {
	// Start failover logger if configured
	if p.failoverLogger != nil {
		p.failoverLogger.Start()
	}

	safego.RunWithRestart(func() {
		for e := range p.producer.Events() {
			switch ev := e.(type) {
			case *kafka.Message:
				failover := false
				messageId := ""
				mp, ok := ev.Opaque.(map[string]any)
				if ok {
					messageId, _ = mp[MessageIdHeader].(string)
					failover, _ = mp["failover"].(bool)
				}
				if ev.TopicPartition.Error != nil {
					ProducerMessages(p.metricsLabelFunc(*ev.TopicPartition.Topic, "error", KafkaErrorCode(ev.TopicPartition.Error))).Inc()
					p.Errorf("Error sending message %s to kafka topic %s: %s", messageId, *ev.TopicPartition.Topic, ev.TopicPartition.Error.Error())
				} else {
					ProducerMessages(p.metricsLabelFunc(*ev.TopicPartition.Topic, "delivered", "")).Inc()
					//p.Debugf("Message ID: %s delivered to topic %s [%d] at offset %v", messageId, *ev.TopicPartition.Topic, ev.TopicPartition.Partition, ev.TopicPartition.Offset)
				}

				// Log to failover logger if configured and conditions are met
				if failover && p.failoverLogger != nil && p.failoverLogger.ShouldLog(ev.TopicPartition.Error) {
					if err := p.failoverLogger.LogPayload(ev.Value); err != nil {
						p.Errorf("Failed to log message to failover logger: %v", err)
					}
				}
			case *kafka.Stats:
				p.handleStats(ev)
			case *kafka.Error, kafka.Error:
				p.Errorf("Producer error: %v", ev)
			}
		}
		p.Infof("Producer closed")
	})
	if p.reportQueueLength {
		// report size metrics
		safego.RunWithRestart(func() {
			ticker := time.NewTicker(time.Second * 15)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if p.closed.Load() {
						return
					}
					ProducerQueueLength.Set(float64(p.producer.Len()))
				}
			}
		})
	}
}

// ProduceSync TODO: transactional delivery?
// produces messages to kafka
func (p *Producer) ProduceSync(topic string, event kafka.Message) error {
	if p.isClosed() {
		return p.NewError("producer is closed")
	}
	started := time.Now()
	deliveryChan := make(chan kafka.Event, 1)
	err := p.producer.Produce(&event, deliveryChan)
	if err != nil {
		ProducerMessages(p.metricsLabelFunc(topic, "error", KafkaErrorCode(err))).Inc()
		return err
	} else {
		ProducerMessages(p.metricsLabelFunc(topic, "produced", "")).Inc()
	}
	p.Debugf("Sent message to kafka topic %s in %s", topic, time.Since(started))
	until := time.After(p.waitForDelivery)
	select {
	case e := <-deliveryChan:
		m := e.(*kafka.Message)
		//messageId := GetKafkaHeader(m, MessageIdHeader)
		if m.TopicPartition.Error != nil {
			ProducerMessages(p.metricsLabelFunc(topic, "error", KafkaErrorCode(m.TopicPartition.Error))).Inc()
			p.Errorf("Error sending message to kafka topic %s: %v", *m.TopicPartition.Topic, m.TopicPartition.Error)
			return m.TopicPartition.Error
		} else {
			ProducerMessages(p.metricsLabelFunc(topic, "delivered", "")).Inc()
			//p.Debugf("Message ID: %s delivered to topic %s [%d] at offset %v", messageId, *m.TopicPartition.Topic, m.TopicPartition.Partition, m.TopicPartition.Offset)
		}

		// Log to failover logger if configured and conditions are met
		if p.failoverLogger != nil && p.failoverLogger.ShouldLog(m.TopicPartition.Error) {
			if err := p.failoverLogger.LogPayload(m.Value); err != nil {
				p.Errorf("Failed to log message to failover logger: %v", err)
			}
		}
	case <-until:
		ProducerMessages(p.metricsLabelFunc(topic, "error", "sync_delivery_timeout")).Inc()
		p.Errorf("Timeout waiting for delivery")
		return fmt.Errorf("timeout waiting for delivery")
	}
	p.Infof("Delivered message to kafka topic %s in %s", topic, time.Since(started))
	return nil
}

// ProduceAsync TODO: transactional delivery?
// produces messages to kafka. When backpressureMaxWait > 0 and librdkafka's
// local queue is full, the call blocks up to backpressureMaxWait while the
// producer drains rather than returning ErrQueueFull immediately. Callers on
// latency-sensitive paths (ingest HTTP handlers) should pass 0; bulkerapp HTTP
// handlers ~5s; backend services / consumers / maintenance tasks ~30s.
func (p *Producer) ProduceAsync(topic string, messageKey string, event []byte, headers map[string]string, partition int32, messageId string, failover bool, backpressureMaxWait time.Duration) error {
	if p.isClosed() {
		return p.NewError("producer is closed")
	}
	errs := multierror.Error{}
	var key []byte
	if messageKey != "" {
		key = []byte(messageKey)
	}
	msg := &kafka.Message{
		Key: key,
		Headers: utils.MapToSlice(headers, func(k string, v string) kafka.Header {
			return kafka.Header{Key: k, Value: []byte(v)}
		}),
		TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: partition},
		Value:          event,
		Opaque: map[string]any{
			MessageIdHeader: messageId,
			"failover":      failover,
		},
	}
	var err error
	if backpressureMaxWait > 0 {
		err = ProduceWithBackpressure(p.producer, msg, p.config.ProducerLingerMs/2, backpressureMaxWait)
	} else {
		err = p.producer.Produce(msg, nil)
	}
	if err != nil {
		ProducerMessages(p.metricsLabelFunc(topic, "error", KafkaErrorCode(err))).Inc()
		errs.Errors = append(errs.Errors, err)

		// Log to failover logger for async production errors
		if failover && p.failoverLogger != nil && p.failoverLogger.ShouldLog(err) {
			if err := p.failoverLogger.LogPayload(event); err != nil {
				p.Errorf("Failed to log message to failover logger: %v", err)
			}
		}
	} else {
		ProducerMessages(p.metricsLabelFunc(topic, "produced", "")).Inc()
	}
	return errs.ErrorOrNil()
}

// Close closes producer
func (p *Producer) Close() error {
	if p == nil || p.isClosed() {
		return nil
	}
	p.closed.Store(true)
	notProduced := p.producer.Flush(p.config.ProducerDeliveryTimeoutMs)
	if notProduced > 0 {
		p.Errorf("%d message left unsent in producer queue.", notProduced)
		//TODO: suck p.producer.ProduceChannel() and store to fallback file or some retry queue
	}
	p.Infof("Closing producer.")
	p.producer.Close()
	close(p.asyncDeliveryChannel)

	// Close failover logger
	if p.failoverLogger != nil {
		if err := p.failoverLogger.Close(); err != nil {
			p.Errorf("Failed to close failover logger: %v", err)
		}
	}

	return nil
}

func (p *Producer) isClosed() bool {
	return p.closed.Load()
}

func (p *Producer) QueueSize() (int, error) {
	if p.isClosed() {
		return 0, p.NewError("producer is closed")
	}

	return p.producer.Len(), nil
}

func (p *Producer) handleStats(ev *kafka.Stats) {
	var stats producerStats
	if err := json.Unmarshal([]byte(ev.String()), &stats); err != nil {
		p.Errorf("Failed to parse producer stats: %v", err)
		return
	}
	// Gauges for current state metrics
	ProducerStatsMsgCnt.Set(stats.MsgCnt)
	ProducerStatsMsgSize.Set(stats.MsgSize)

	// Counters for cumulative metrics — add only the delta since last stats callback
	if delta := stats.TxMsgs - p.prevTxMsgs; delta > 0 {
		ProducerStatsTxMsgs.Add(delta)
	}
	p.prevTxMsgs = stats.TxMsgs

	if delta := stats.TxMsgBytes - p.prevTxMsgBytes; delta > 0 {
		ProducerStatsTxMsgBytes.Add(delta)
	}
	p.prevTxMsgBytes = stats.TxMsgBytes

	if delta := stats.Tx - p.prevTx; delta > 0 {
		ProducerStatsTx.Add(delta)
	}
	p.prevTx = stats.Tx

	if delta := stats.TxBytes - p.prevTxBytes; delta > 0 {
		ProducerStatsTxBytes.Add(delta)
	}
	p.prevTxBytes = stats.TxBytes

	for _, broker := range stats.Brokers {
		if broker.Nodeid < 0 {
			continue // skip internal brokers
		}
		ProducerStatsBrokerRtt(broker.Name).Set(broker.Rtt.Avg)
		ProducerStatsBrokerOutbufCnt(broker.Name).Set(broker.OutbufCnt)
		ProducerStatsBrokerWaitrespCnt(broker.Name).Set(broker.WaitrespCnt)
	}
}

func defaultMetricsLabelFunc(topicId string, status, errText string) (topic, destinationId, mode, tableName, st string, err string) {
	return topicId, "", "", "", status, errText
}
