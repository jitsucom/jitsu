package kafkabase

import (
	"fmt"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	producerMessages = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "messages",
	}, []string{"producer", "topicId", "destinationId", "mode", "tableName", "status", "errorType"})
	ProducerMessages = func(topicId, destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return producerMessages.WithLabelValues("", topicId, destinationId, mode, tableName, status, errorType)
	}

	producerQueueLength = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "queue_length",
	}, []string{"producer"})

	// librdkafka internal statistics
	producerStatsMsgCnt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_msg_cnt",
		Help:      "Current number of messages in producer queues",
	}, []string{"producer"})
	producerStatsMsgSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_msg_size_bytes",
		Help:      "Current total size of messages in producer queues",
	}, []string{"producer"})
	producerStatsTxMsgs = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_txmsgs_total",
		Help:      "Total number of messages transmitted (produced) to Kafka brokers",
	}, []string{"producer"})
	producerStatsTxMsgBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_txmsg_bytes_total",
		Help:      "Total number of message bytes transmitted to Kafka brokers",
	}, []string{"producer"})
	producerStatsTx = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_tx_total",
		Help:      "Total number of requests sent to Kafka brokers",
	}, []string{"producer"})
	producerStatsTxBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_tx_bytes_total",
		Help:      "Total number of bytes transmitted to Kafka brokers",
	}, []string{"producer"})
	producerStatsBrokerRtt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_rtt_avg_us",
		Help:      "Broker round-trip time average in microseconds",
	}, []string{"producer", "broker"})

	producerStatsBrokerOutbufCnt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_outbuf_cnt",
		Help:      "Number of requests awaiting transmission to broker",
	}, []string{"producer", "broker"})

	producerStatsBrokerWaitrespCnt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_waitresp_cnt",
		Help:      "Number of requests in-flight to broker awaiting response",
	}, []string{"producer", "broker"})
)

// Each producer owns its metric series. Unnamed producers keep the empty label
// for compatibility with services that do not distinguish producer roles.
type producerMetrics struct {
	name                            string
	queueLength, msgCnt, msgSize    prometheus.Gauge
	txMsgs, txMsgBytes, tx, txBytes prometheus.Counter
}

func newProducerMetrics(name string) *producerMetrics {
	return &producerMetrics{
		name:        name,
		queueLength: producerQueueLength.WithLabelValues(name),
		msgCnt:      producerStatsMsgCnt.WithLabelValues(name),
		msgSize:     producerStatsMsgSize.WithLabelValues(name),
		txMsgs:      producerStatsTxMsgs.WithLabelValues(name),
		txMsgBytes:  producerStatsTxMsgBytes.WithLabelValues(name),
		tx:          producerStatsTx.WithLabelValues(name),
		txBytes:     producerStatsTxBytes.WithLabelValues(name),
	}
}

func (m *producerMetrics) messages(topicId, destinationId, mode, tableName, status, errorType string) prometheus.Counter {
	return producerMessages.WithLabelValues(m.name, topicId, destinationId, mode, tableName, status, errorType)
}

func KafkaErrorCode(err error) string {
	if err == nil {
		return ""
	}

	if kafkaError, ok := err.(kafka.Error); ok {
		return fmt.Sprintf("kafka %serror: %s", utils.Ternary(kafkaError.IsRetriable(), "retriable ", ""), kafkaError.Code().String())
	}

	return "kafka_error"
}

func KafkaRetryableError(err error) bool {
	if err == nil {
		return false
	}

	if kafkaError, ok := err.(kafka.Error); ok {
		return kafkaError.IsRetriable()
	}

	return true
}
