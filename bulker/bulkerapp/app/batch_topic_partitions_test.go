package app

import (
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
)

func TestBatchTopicPartitionConfiguration(t *testing.T) {
	const topic = "in.id.workspace_backup.m.batch.t.backup"
	for _, raw := range []string{`null`, `[]`, `{"x":4}`, `{"in.id.x.m.stream.t.events":4}`, `{"in.id.x.m.batch.t.events":0}`, `{"in.id.x.m.batch.t.events":1.5}`} {
		c := &Config{KafkaBatchTopicPartitions: raw}
		require.Error(t, c.parseBatchTopicPartitions(), raw)
	}
	c := &Config{KafkaBatchTopicPartitions: `{"` + topic + `":4}`}
	require.NoError(t, c.parseBatchTopicPartitions())
	require.Equal(t, 4, c.destinationTopicPartitions(topic))
	require.Equal(t, 1, c.destinationTopicPartitions("in.id.other.m.batch.t.backup"))
	require.False(t, c.KafkaBatchTopicPartitionExpansion, "expansion requires separate opt-in")
	c.KafkaBatchTopicPartitions = ""
	require.NoError(t, c.parseBatchTopicPartitions())
	require.Equal(t, 1, c.destinationTopicPartitions(topic))
}

func TestPartitionExpansionRequiresSuccessfulTopicResult(t *testing.T) {
	require.Error(t, validatePartitionExpansion("topic", nil))
	require.Error(t, validatePartitionExpansion("topic", []kafka.TopicResult{{Topic: "other"}}))
	require.Error(t, validatePartitionExpansion("topic", []kafka.TopicResult{{Topic: "topic", Error: kafka.NewError(kafka.ErrTopicAuthorizationFailed, "denied", false)}}))
	require.NoError(t, validatePartitionExpansion("topic", []kafka.TopicResult{{Topic: "topic"}}))
}

func TestConsumerOwnershipWithMultiplePartitions(t *testing.T) {
	for _, mode := range []string{"batch", retryTopicMode} {
		for _, partitions := range []int{1, 2, 7} {
			owners := 0
			for shard := 0; shard < 3; shard++ {
				tm := &TopicManager{config: &Config{ShardsCount: 3}, enableConsumers: true, shardNumber: shard}
				start, invalid := tm.startConsumerOnThisShard("in.id.test.m."+mode+".t.backup", mode, "test", "backup", partitions)
				require.False(t, invalid)
				if start {
					owners++
				}
			}
			expected := 1
			if mode == retryTopicMode {
				expected = min(partitions, 3)
			}
			require.Equal(t, expected, owners)
		}
	}
}

// Regression for the map/ready race between metadata refresh and retry routing.
func TestEnsureTopicDuringMetadataRefresh(t *testing.T) {
	const topic = "existing-retry-topic"
	tm := &TopicManager{allTopics: types.NewSet[string](topic)}
	var workers sync.WaitGroup
	workers.Add(1)
	go func() {
		defer workers.Done()
		for i := 0; i < 1000; i++ {
			tm.Lock()
			tm.allTopics = types.NewSet[string](topic)
			tm.ready = i%2 == 0
			tm.Unlock()
		}
	}()
	for i := 0; i < 1000; i++ {
		require.NoError(t, tm.ensureTopic(topic, 1, nil))
	}
	workers.Wait()
}
