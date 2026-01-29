package kafkabase

import (
	"fmt"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/appbase"
)

type KafkaConfig struct {
	// KafkaBootstrapServers List of Kafka brokers separated by comma. Each broker should be in format host:port.
	KafkaBootstrapServers string `mapstructure:"KAFKA_BOOTSTRAP_SERVERS"`
	KafkaSSL              bool   `mapstructure:"KAFKA_SSL" default:"false"`
	KafkaSSLSkipVerify    bool   `mapstructure:"KAFKA_SSL_SKIP_VERIFY" default:"false"`
	KafkaSSLCA            string `mapstructure:"KAFKA_SSL_CA"`
	KafkaSSLCAFile        string `mapstructure:"KAFKA_SSL_CA_FILE"`

	// Kafka authorization as JSON object {"mechanism": "SCRAM-SHA-256|PLAIN", "username": "user", "password": "password"}
	KafkaSASL string `mapstructure:"KAFKA_SASL"`

	KafkaSessionTimeoutMs     int    `mapstructure:"KAFKA_SESSION_TIMEOUT_MS" default:"45000"`
	KafkaMaxPollIntervalMs    int    `mapstructure:"KAFKA_MAX_POLL_INTERVAL_MS" default:"300000"`
	KafkaTopicCompression     string `mapstructure:"KAFKA_TOPIC_COMPRESSION" default:"snappy"`
	KafkaTopicRetentionHours  int    `mapstructure:"KAFKA_TOPIC_RETENTION_HOURS" default:"48"`
	KafkaTopicSegmentHours    int    `mapstructure:"KAFKA_TOPIC_SEGMENT_HOURS" default:"24"`
	KafkaTopicPrefix          string `mapstructure:"KAFKA_TOPIC_PREFIX" default:""`
	KafkaFetchMessageMaxBytes int    `mapstructure:"KAFKA_FETCH_MESSAGE_MAX_BYTES" default:"1048576"`

	KafkaRetryTopicSegmentBytes              int    `mapstructure:"KAFKA_RETRY_TOPIC_SEGMENT_BYTES" default:"104857600"`
	KafkaRetryTopicRetentionHours            int    `mapstructure:"KAFKA_RETRY_TOPIC_RETENTION_HOURS" default:"48"`
	KafkaDeadTopicRetentionHours             int    `mapstructure:"KAFKA_DEAD_TOPIC_RETENTION_HOURS" default:"168"`
	KafkaTopicReplicationFactor              int    `mapstructure:"KAFKA_TOPIC_REPLICATION_FACTOR"`
	KafkaAdminMetadataTimeoutMs              int    `mapstructure:"KAFKA_ADMIN_METADATA_TIMEOUT_MS" default:"1000"`
	KafkaConsumerPartitionsAssigmentStrategy string `mapstructure:"KAFKA_CONSUMER_PARTITIONS_ASSIGMENT_STRATEGY" default:"roundrobin"`

	// KafkaDestinationsTopicName destination topic for /ingest endpoint
	KafkaDestinationsTopicName       string `mapstructure:"KAFKA_DESTINATIONS_TOPIC_NAME" default:"destination-messages"`
	KafkaDestinationsTopicPartitions int    `mapstructure:"KAFKA_DESTINATIONS_TOPIC_PARTITIONS" default:"16"`

	KafkaDestinationsRetryTopicName      string `mapstructure:"KAFKA_DESTINATIONS_RETRY_TOPIC_NAME" default:"destination-messages-retry"`
	KafkaDestinationsDeadLetterTopicName string `mapstructure:"KAFKA_DESTINATIONS_DEAD_LETTER_TOPIC_NAME" default:"destination-messages-dead-letter"`

	// ProducerWaitForDeliveryMs For ProduceSync only is a timeout for producer to wait for delivery report.
	ProducerQueueSize int `mapstructure:"PRODUCER_QUEUE_SIZE" default:"100000"`
	// ProducerQueueSizeThreshold when queue size reaches this value, health check will return unhealthy
	ProducerQueueSizeThreshold float64 `mapstructure:"PRODUCER_QUEUE_SIZE_THRESHOLD" default:"0.5"`
	ProducerBatchSize          int     `mapstructure:"PRODUCER_BATCH_SIZE" default:"65535"`
	ProducerLingerMs           int     `mapstructure:"PRODUCER_LINGER_MS" default:"1000"`
	ProducerWaitForDeliveryMs  int     `mapstructure:"PRODUCER_WAIT_FOR_DELIVERY_MS" default:"1000"`

	// Failover logger configuration
	FailoverLoggerEnvConfig `mapstructure:",squash"`
}

// GetKafkaConfig returns kafka config
func (ac *KafkaConfig) GetKafkaConfig() *kafka.ConfigMap {
	if ac.KafkaBootstrapServers == "" {
		panic("❗️Kafka bootstrap servers are not set. Please set KAFKA_BOOTSTRAP_SERVERS env variable")
	}
	kafkaConfig := &kafka.ConfigMap{
		"client.id":                "bulkerapp",
		"bootstrap.servers":        ac.KafkaBootstrapServers,
		"reconnect.backoff.ms":     1000,
		"reconnect.backoff.max.ms": 10000,
	}
	if ac.KafkaSSL {
		if ac.KafkaSASL != "" {
			_ = kafkaConfig.SetKey("security.protocol", "SASL_SSL")
		} else {
			_ = kafkaConfig.SetKey("security.protocol", "SSL")
		}
		if ac.KafkaSSLSkipVerify {
			_ = kafkaConfig.SetKey("enable.ssl.certificate.verification", false)
		}
		if ac.KafkaSSLCA != "" {
			_ = kafkaConfig.SetKey("ssl.ca.pem", ac.KafkaSSLCA)
		}
		if ac.KafkaSSLCAFile != "" {
			_ = kafkaConfig.SetKey("ssl.ca.location", ac.KafkaSSLCAFile)
		}
	}
	if ac.KafkaSASL != "" {
		sasl := map[string]interface{}{}
		err := hjson.Unmarshal([]byte(ac.KafkaSASL), &sasl)
		if err != nil {
			panic(fmt.Errorf("error parsing Kafka SASL config: %v", err))
		}
		for k, v := range sasl {
			_ = kafkaConfig.SetKey("sasl."+k, v)
		}
	}

	return kafkaConfig
}

func (c *KafkaConfig) PostInit(settings *appbase.AppSettings) error {
	return nil
}
