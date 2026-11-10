package main

import (
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/kafkabase"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
)

func testProducerContext(servers, failoverPath string) *Context {
	config := &Config{
		KafkaConfig: kafkabase.KafkaConfig{
			KafkaBootstrapServers:        servers,
			KafkaDestinationsTopicName:   "pipeline",
			ProducerQueueSize:            1,
			ProducerBatchSize:            65535,
			ProducerLingerMs:             1,
			ProducerDeliveryTimeoutMs:    10000,
			ProducerStatisticsIntervalMs: 100,
			KafkaTopicCompression:        "none",
			FailoverLoggerEnvConfig: kafkabase.FailoverLoggerEnvConfig{
				FailoverLoggerEnabled:  true,
				FailoverLoggerBasePath: failoverPath,
			},
		},
		ProducerQueueSizeKB:     1024,
		BackupProducerQueueSize: 1, BackupProducerQueueSizeKB: 1024,
		TelemetryProducerQueueSize: 1, TelemetryProducerQueueSizeKB: 1024,
	}
	return &Context{config: config, kafkaConfig: config.GetKafkaConfig()}
}

func TestBackgroundQueueSaturationDoesNotBlockPipeline(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	require.NoError(t, cluster.CreateTopic("pipeline", 1, 1))
	require.NoError(t, cluster.SetBrokerDown(1))
	failoverPath := t.TempDir()
	app := testProducerContext(cluster.BootstrapServers(), failoverPath)
	require.NoError(t, app.initProducers())
	defer app.closeProducers()
	// Restore connectivity even if an assertion fails, so cleanup can flush.
	defer cluster.SetBrokerUp(1)

	for _, p := range []*kafkabase.Producer{app.backupProducer, app.telemetryProducer} {
		require.NoError(t, p.ProduceAsync("background", "", []byte(`{"background":true}`), nil, kafka.PartitionAny, "", false, 0))
		require.ErrorContains(t, p.ProduceAsync("background", "", []byte(`{"rejected-background":true}`), nil, kafka.PartitionAny, "", false, 0), "Queue full")
	}
	router := &Router{
		Router: &appbase.Router{Service: appbase.NewServiceBase("producer-isolation-test")},
		config: app.config, producer: app.producer,
		backupProducer: app.backupProducer, telemetryProducer: app.telemetryProducer,
		partitionSelector: &kafkabase.DummyPartitionSelector{},
	}
	stream := &StreamWithDestinations{
		Stream: StreamConfig{WorkspaceId: "test"}, BackupEnabled: true,
		AsynchronousDestinations: []*ShortDestinationConfig{{ConnectionId: "test-connection"}},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	payload := []byte(`{"messageId":"accepted","httpPayload":{"event":"test"}}`)
	destinations, _, routeErr := router.sendToRotor(c, "accepted", payload, stream, false)
	require.Nil(t, routeErr)
	require.Equal(t, []string{"test-connection"}, destinations)

	// Only the primary queue owns recovery files and retains failover behavior.
	rejected := []byte(`{"messageId":"rejected","httpPayload":{"event":"test"}}`)
	_, _, routeErr = router.sendToRotor(c, "rejected", rejected, stream, false)
	require.NotNil(t, routeErr)
	require.Equal(t, ErrProducerType, routeErr.ErrorType)
	require.ErrorContains(t, routeErr.Error, "Queue full")
	files, err := filepath.Glob(filepath.Join(failoverPath, "*.tmp"))
	require.NoError(t, err)
	require.Len(t, files, 1)
	content, err := os.ReadFile(files[0])
	require.NoError(t, err)
	require.Equal(t, string(rejected)+"\n", string(content))

	require.NoError(t, cluster.SetBrokerUp(1))
	consumer, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers": cluster.BootstrapServers(), "group.id": "isolation-proof",
		"enable.auto.commit": false,
	})
	require.NoError(t, err)
	defer consumer.Close()
	topic := "pipeline"
	require.NoError(t, consumer.Assign([]kafka.TopicPartition{{Topic: &topic, Partition: 0, Offset: kafka.OffsetBeginning}}))
	message, err := consumer.ReadMessage(10 * time.Second)
	require.NoError(t, err)
	require.Equal(t, payload, message.Value)
	require.Contains(t, message.Headers, kafka.Header{Key: ConnectionIdsHeader, Value: []byte("test-connection")})

	require.Eventually(t, func() bool {
		families, err := prometheus.DefaultGatherer.Gather()
		if err != nil {
			return false
		}
		roles := map[string]bool{}
		for _, family := range families {
			if family.GetName() != "bulkerapp_producer_stats_broker_rtt_avg_us" {
				continue
			}
			for _, metric := range family.Metric {
				for _, label := range metric.Label {
					if label.GetName() == "producer" {
						roles[label.GetValue()] = true
					}
				}
			}
		}
		return roles["pipeline"] && roles["backup"] && roles["telemetry"]
	}, 5*time.Second, 20*time.Millisecond)
	app.closeProducers()
	for _, p := range []*kafkabase.Producer{app.producer, app.backupProducer, app.telemetryProducer} {
		_, err := p.QueueSize()
		require.ErrorContains(t, err, "closed")
	}
}

func TestProducerInitializationFailureClosesEarlierClients(t *testing.T) {
	app := testProducerContext("127.0.0.1:1", t.TempDir())
	app.config.TelemetryProducerQueueSizeKB = -1
	require.Error(t, app.initProducers())
	require.NotNil(t, app.producer)
	require.NotNil(t, app.backupProducer)
	for _, p := range []*kafkabase.Producer{app.producer, app.backupProducer} {
		_, err := p.QueueSize()
		require.ErrorContains(t, err, "closed")
	}
}

func TestDeadLetterSkipsProducerRejections(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	topic := "dead-letter"
	require.NoError(t, cluster.CreateTopic(topic, 1, 1))
	app := testProducerContext(cluster.BootstrapServers(), t.TempDir())
	app.config.TelemetryProducerQueueSize = 10
	app.config.KafkaDestinationsDeadLetterTopicName = topic
	app.config.MaxIngestPayloadSize = 10
	require.NoError(t, app.initProducers())
	defer app.closeProducers()
	router := &Router{config: app.config, telemetryProducer: app.telemetryProducer}

	for _, failoverEnabled := range []bool{true, false} {
		app.config.FailoverLoggerEnabled = failoverEnabled
		router.sendToDeadLetter("producer-rejected", []byte("must not be copied"), &appbase.RouterError{
			ErrorType: ErrProducerType, Error: errors.New("Local: Queue full"),
		})
	}
	router.sendToDeadLetter("accepted", []byte("must not be copied"), nil)
	for _, errorType := range []string{"parse error", ErrThrottledType} {
		router.sendToDeadLetter("rejected", []byte("0123456789truncated"), &appbase.RouterError{
			ErrorType: errorType, Error: errors.New(errorType),
		})
	}

	consumer, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers": cluster.BootstrapServers(), "group.id": "dead-letter-proof",
		"enable.auto.commit": false,
	})
	require.NoError(t, err)
	defer consumer.Close()
	require.NoError(t, consumer.Assign([]kafka.TopicPartition{{Topic: &topic, Partition: 0, Offset: kafka.OffsetBeginning}}))
	for _, errorType := range []string{"parse error", ErrThrottledType} {
		message, err := consumer.ReadMessage(10 * time.Second)
		require.NoError(t, err)
		require.Equal(t, []byte("0123456789"), message.Value)
		require.Contains(t, message.Headers, kafka.Header{Key: "error", Value: []byte(errorType)})
	}
	_, err = consumer.ReadMessage(time.Second)
	var kafkaErr kafka.Error
	require.ErrorAs(t, err, &kafkaErr)
	require.Equal(t, kafka.ErrTimedOut, kafkaErr.Code())
}
