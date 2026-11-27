package main

import (
	"context"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/require"
)

func TestPartitionLagsOnlyIncludeValidPipelineOffsets(t *testing.T) {
	topic, other := "functions-pipeline", "shard"
	commits := []kafka.TopicPartition{
		{Topic: &topic, Partition: 0, Offset: 5},
		{Topic: &topic, Partition: 64, Offset: kafka.OffsetInvalid},
		{Topic: &topic, Partition: 65, Offset: kafka.OffsetInvalid},
		{Topic: &other, Partition: 0, Offset: 25},
		{Topic: &other, Partition: 19, Offset: 1},
		{Topic: &topic, Partition: 1, Error: kafka.NewError(kafka.ErrUnknownPartition, "", false)},
		{Topic: &topic, Partition: 2, Offset: 42},
	}
	ends := kafka.ListOffsetsResult{ResultInfos: map[kafka.TopicPartition]kafka.ListOffsetsResultInfo{
		{Topic: &topic, Partition: 0}:  {Offset: 30},
		{Topic: &topic, Partition: 64}: {Offset: 0},
		{Topic: &topic, Partition: 65}: {Offset: 1000005},
		{Topic: &other, Partition: 0}:  {Offset: 500},
		{Topic: &other, Partition: 19}: {Offset: 75},
		{Topic: &topic, Partition: 1}:  {Offset: 9},
		{Topic: &topic, Partition: 2}:  {Offset: kafka.OffsetInvalid, Error: kafka.NewError(kafka.ErrUnknownPartition, "", false)},
	}}
	starts, missing := committedStarts(topic, commits)
	require.Equal(t, map[kafka.TopicPartition]kafka.OffsetSpec{
		{Topic: &topic, Partition: 64}: kafka.EarliestOffsetSpec,
		{Topic: &topic, Partition: 65}: kafka.EarliestOffsetSpec,
	}, missing)
	starts[64], starts[65] = 0, 1000000
	require.Equal(t, map[int32]int64{0: 25, 64: 0, 65: 5}, partitionLags(starts, validOffsets(topic, ends)))
}

func TestStalePipelinePartitionHintRetriesBeforeFailover(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	topic := "pipeline"
	require.NoError(t, cluster.CreateTopic(topic, 1, 1))
	dir := t.TempDir()
	app := testProducerContext(cluster.BootstrapServers(), dir)
	require.NoError(t, app.initProducers())
	defer app.closeProducers()
	admin, err := app.producer.NewAdminClient()
	require.NoError(t, err)
	defer admin.Close()
	_, err = admin.GetMetadata(&topic, false, 5000)
	require.NoError(t, err)

	// Strictly addressed messages must still fail and be archived once.
	require.ErrorContains(t, app.producer.ProduceAsync(topic, "strict", []byte("strict"), nil, 64, "strict", true, 0), "Unknown partition")
	require.NoError(t, app.producer.ProduceWithPartitionHint(topic, "key", []byte("hint"), map[string]string{"header": "value"}, 64, "hint", true))

	consumer, err := kafka.NewConsumer(&kafka.ConfigMap{"bootstrap.servers": cluster.BootstrapServers(), "group.id": "stale-hint", "enable.auto.commit": false})
	require.NoError(t, err)
	defer consumer.Close()
	require.NoError(t, consumer.Assign([]kafka.TopicPartition{{Topic: &topic, Partition: 0, Offset: kafka.OffsetBeginning}}))
	message, err := consumer.ReadMessage(5 * time.Second)
	require.NoError(t, err)
	require.Equal(t, []byte("hint"), message.Value)
	require.Equal(t, []byte("key"), message.Key)
	require.Contains(t, message.Headers, kafka.Header{Key: "header", Value: []byte("value")})
	_, high, err := consumer.QueryWatermarkOffsets(topic, 0, 5000)
	require.NoError(t, err)
	require.EqualValues(t, 1, high)
	files, err := filepath.Glob(filepath.Join(dir, "*.tmp"))
	require.NoError(t, err)
	require.Len(t, files, 1)
	content, err := os.ReadFile(files[0])
	require.NoError(t, err)
	require.Equal(t, "strict\n", string(content))
}

// Run against a disposable Kafka broker to exercise coordinator startup and
// live expansion. The native mock broker lacks the required admin APIs.
func TestWeightedRoutingAfterPartitionExpansion(t *testing.T) {
	servers := os.Getenv("BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS")
	if servers == "" {
		t.Skip("set BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS to use an isolated broker")
	}
	app := testProducerContext(servers, t.TempDir())
	app.config.ProducerQueueSize = 100
	app.config.WeightedPartitionSelectorLagThreshold = 1
	require.NoError(t, app.initProducers())
	defer app.closeProducers()
	topic := "ingest-expansion-" + rand.Text()
	monitor, err := NewConsumerMonitor(app, topic, topic+"-rotor")
	require.NoError(t, err)
	defer monitor.Close()
	admin, err := app.producer.NewAdminClient()
	require.NoError(t, err)
	defer admin.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	_, err = monitor.partitionWeights(ctx)
	require.Error(t, err)
	// Successful creation also proves the lookup did not create this topic.
	created, err := admin.CreateTopics(ctx, []kafka.TopicSpecification{{Topic: topic, NumPartitions: 1, ReplicationFactor: 1}})
	require.NoError(t, err)
	require.Len(t, created, 1)
	require.Equal(t, kafka.ErrNoError, created[0].Error.Code())
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := admin.DeleteTopics(cleanup, []string{topic})
		if err != nil {
			t.Logf("topic cleanup: %v", err)
		}
	}()
	for i := 0; i < 10; i++ {
		require.NoError(t, app.producer.ProduceAsync(topic, "", []byte("event"), nil, 0, "", false, time.Second))
	}
	require.Eventually(t, func() bool { return monitor.SelectPartition() == 0 }, 45*time.Second, 200*time.Millisecond)

	expanded, err := admin.CreatePartitions(ctx, []kafka.PartitionsSpecification{{Topic: topic, IncreaseTo: 3}})
	require.NoError(t, err)
	require.Len(t, expanded, 1)
	require.Equal(t, kafka.ErrNoError, expanded[0].Error.Code())
	seen := map[int32]bool{}
	require.Eventually(t, func() bool {
		seen[monitor.SelectPartition()] = true
		return seen[1] && seen[2]
	}, 30*time.Second, 50*time.Millisecond)
}
