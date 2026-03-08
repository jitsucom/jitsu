package metrics

import (
	"fmt"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	ingestHandlerRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "handler",
		Name:      "ingest",
		Help:      "Ingest handler errors by destination Id",
	}, []string{"slug", "status", "errorType"})
	IngestHandlerRequests = func(slug, status, errorType string) prometheus.Counter {
		return ingestHandlerRequests.WithLabelValues(slug, status, errorType)
	}

	ingestedMessages = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "ingest",
		Name:      "messages",
		Help:      "Messages ingested by destination Id",
	}, []string{"destinationId", "status", "errorType"})
	IngestedMessages = func(destinationId, status, errorType string) prometheus.Counter {
		return ingestedMessages.WithLabelValues(destinationId, status, errorType)
	}

	eventsHandlerRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "handler",
		Name:      "events",
		Help:      "Events handler statuses by destination Id",
	}, []string{"destinationId", "mode", "tableName", "status", "errorType"})
	EventsHandlerRequests = func(destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return eventsHandlerRequests.WithLabelValues(destinationId, mode, tableName, status, errorType)
	}

	bulkHandlerRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "handler",
		Name:      "bulk",
		Help:      "Events handler errors by destination Id",
	}, []string{"destinationId", "mode", "tableName", "status", "errorType"})
	BulkHandlerRequests = func(destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return bulkHandlerRequests.WithLabelValues(destinationId, mode, tableName, status, errorType)
	}

	eventsHandlerBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "handler",
		Name:      "bytes",
		Help:      "Events handler bytes by destination Id",
	}, []string{"destinationId", "mode", "tableName", "status", "errorType"})
	EventsHandlerBytes = func(destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return eventsHandlerBytes.WithLabelValues(destinationId, mode, tableName, status, errorType)
	}

	topicManagerCreate = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "create",
	}, []string{"topicId", "destinationId", "mode", "tableName", "status", "errorType"})
	TopicManagerCreate = func(topicId, destinationId, mode, tableName, status, errorType string) prometheus.Counter {
		return topicManagerCreate.WithLabelValues(topicId, destinationId, mode, tableName, status, errorType)
	}

	topicManagerError = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "error",
	}, []string{"errorType"})
	TopicManagerError = func(errorType string) prometheus.Counter {
		return topicManagerError.WithLabelValues(errorType)
	}

	topicManagerDestinations = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "destinations",
		Help:      "Number of destination topics with errors by destination mode",
	}, []string{"mode", "status"})
	TopicManagerDestinations = func(mode, status string) prometheus.Gauge {
		return topicManagerDestinations.WithLabelValues(mode, status)
	}

	TopicManagerAbandonedTopics = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "abandoned_topics",
		Help:      "Number of abandoned topics. Abandoned topics are destination topics that are not used by any destination",
	})
	TopicManagerAllTopics = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "all_topics",
		Help:      "Number of topics.",
	})
	TopicManagerStaleTopics = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "topic_manager",
		Name:      "stale_topics",
		Help:      "Number of stale topics.",
	})

	consumerErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "consumer",
		Name:      "error",
	}, []string{"topicId", "mode", "destinationId", "tableName", "errorType"})
	ConsumerErrors = func(topicId, mode, destinationId, tableName, errorType string) prometheus.Counter {
		return consumerErrors.WithLabelValues(topicId, mode, destinationId, tableName, errorType)
	}

	consumerMessages = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "consumer",
		Name:      "messages",
	}, []string{"topicId", "mode", "destinationId", "tableName", "status"})
	ConsumerMessages = func(topicId, mode, destinationId, tableName, status string) prometheus.Counter {
		return consumerMessages.WithLabelValues(topicId, mode, destinationId, tableName, status)
	}

	connectionMessageStatuses = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "connection_message_statuses",
	}, []string{"destinationId", "tableName", "status"})
	ConnectionMessageStatuses = func(destinationId, tableName, status string) prometheus.Counter {
		return connectionMessageStatuses.WithLabelValues(destinationId, tableName, status)
	}

	consumerQueueSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "consumer",
		Name:      "queue_size",
	}, []string{"topicId", "mode", "destinationId", "tableName"})
	ConsumerQueueSize = func(topicId, mode, destinationId, tableName string) prometheus.Gauge {
		return consumerQueueSize.WithLabelValues(topicId, mode, destinationId, tableName)
	}

	consumerRuns = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "consumer",
		Name:      "run",
	}, []string{"topicId", "mode", "destinationId", "tableName", "status"})
	ConsumerRuns = func(topicId, mode, destinationId, tableName, status string) prometheus.Counter {
		return consumerRuns.WithLabelValues(topicId, mode, destinationId, tableName, status)
	}

	configurationSourceError = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "configuration",
		Name:      "error",
	}, []string{"errorType"})
	ConfigurationSourceError = func(errorType string) prometheus.Counter {
		return configurationSourceError.WithLabelValues(errorType)
	}

	repositoryDestinations = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "repository",
		Name:      "destinations",
	}, []string{"status"})
	RepositoryDestinations = func(status string) prometheus.Counter {
		return repositoryDestinations.WithLabelValues(status)
	}

	repositoryDestinationInitError = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "repository",
		Name:      "destination_init_error",
	}, []string{"destinationId"})
	RepositoryDestinationInitError = func(destinationId string) prometheus.Counter {
		return repositoryDestinationInitError.WithLabelValues(destinationId)
	}

	panics = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "bulkerapp",
		Subsystem: "safego",
		Name:      "panic",
	})
	Panics = func() prometheus.Counter {
		return panics
	}

	ProducerBackPressureDelayMs = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "bulkerapp",
		Subsystem: "producer",
		Name:      "back_pressure_delay_ms",
		Help:      "Current back pressure delay applied to producer requests in milliseconds",
	})
)

func KafkaErrorCode(err error) string {
	if err == nil {
		return ""
	}

	if kafkaError, ok := err.(kafka.Error); ok {
		return fmt.Sprintf("kafka error: %s", kafkaError.Code().String())
	}

	return "kafka_error"
}
