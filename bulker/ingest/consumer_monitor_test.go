package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/stretchr/testify/require"
)

func TestPartitionLagsOnlyIncludeValidPipelineOffsets(t *testing.T) {
	topic, other := "functions-pipeline", "shard"
	commits := kafka.ListConsumerGroupOffsetsResult{ConsumerGroupsTopicPartitions: []kafka.ConsumerGroupTopicPartitions{{Partitions: []kafka.TopicPartition{
		{Topic: &topic, Partition: 0, Offset: 5},
		{Topic: &topic, Partition: 64, Offset: kafka.OffsetInvalid},
		{Topic: &other, Partition: 0, Offset: 25},
		{Topic: &other, Partition: 19, Offset: 1},
		{Topic: &topic, Partition: 1, Error: kafka.NewError(kafka.ErrUnknownPartition, "", false)},
		{Topic: &topic, Partition: 2, Offset: 42},
	}}}}
	ends := kafka.ListOffsetsResult{ResultInfos: map[kafka.TopicPartition]kafka.ListOffsetsResultInfo{
		{Topic: &topic, Partition: 0}:  {Offset: 30},
		{Topic: &topic, Partition: 64}: {Offset: 0},
		{Topic: &other, Partition: 0}:  {Offset: 500},
		{Topic: &other, Partition: 19}: {Offset: 75},
		{Topic: &topic, Partition: 1}:  {Offset: 9},
		{Topic: &topic, Partition: 2}:  {Offset: kafka.OffsetInvalid, Error: kafka.NewError(kafka.ErrUnknownPartition, "", false)},
	}}
	require.Equal(t, map[int32]int64{0: 25, 64: 0}, partitionLags(topic, commits, ends))
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
