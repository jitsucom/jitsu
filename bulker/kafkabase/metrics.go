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
	}, []string{"topicId", "destinationId", "mode", "tableName", "status", "errorType"})
	ProducerMessages = func(topicId, destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return producerMessages.WithLabelValues(topicId, destinationId, mode, tableName, status, errorType)
	}

	ProducerQueueLength = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "queue_length",
	})

	// librdkafka internal statistics
	ProducerStatsMsgCnt = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_msg_cnt",
		Help:      "Current number of messages in producer queues",
	})
	ProducerStatsMsgSize = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_msg_size_bytes",
		Help:      "Current total size of messages in producer queues",
	})
	ProducerStatsTxMsgs = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_txmsgs_total",
		Help:      "Total number of messages transmitted (produced) to Kafka brokers",
	})
	ProducerStatsTxMsgBytes = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_txmsg_bytes_total",
		Help:      "Total number of message bytes transmitted to Kafka brokers",
	})
	ProducerStatsTx = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_tx_total",
		Help:      "Total number of requests sent to Kafka brokers",
	})
	ProducerStatsTxBytes = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_tx_bytes_total",
		Help:      "Total number of bytes transmitted to Kafka brokers",
	})
	producerStatsBrokerRtt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_rtt_avg_us",
		Help:      "Broker round-trip time average in microseconds",
	}, []string{"broker"})
	ProducerStatsBrokerRtt = func(broker string) prometheus.Gauge {
		return producerStatsBrokerRtt.WithLabelValues(broker)
	}
	producerStatsBrokerOutbufCnt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_outbuf_cnt",
		Help:      "Number of requests awaiting transmission to broker",
	}, []string{"broker"})
	ProducerStatsBrokerOutbufCnt = func(broker string) prometheus.Gauge {
		return producerStatsBrokerOutbufCnt.WithLabelValues(broker)
	}
	producerStatsBrokerWaitrespCnt = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "stats_broker_waitresp_cnt",
		Help:      "Number of requests in-flight to broker awaiting response",
	}, []string{"broker"})
	ProducerStatsBrokerWaitrespCnt = func(broker string) prometheus.Gauge {
		return producerStatsBrokerWaitrespCnt.WithLabelValues(broker)
	}
)

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
