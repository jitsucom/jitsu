package app

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
)

func (c *Config) parseBatchTopicPartitions() error {
	counts := map[string]int{}
	if c.KafkaBatchTopicPartitions != "" {
		if err := json.Unmarshal([]byte(c.KafkaBatchTopicPartitions), &counts); err != nil {
			return fmt.Errorf("KAFKA_BATCH_TOPIC_PARTITIONS must be a JSON object: %w", err)
		}
		if counts == nil {
			return fmt.Errorf("KAFKA_BATCH_TOPIC_PARTITIONS must be a JSON object")
		}
	}
	for topic, count := range counts {
		_, mode, _, err := ParseTopicId(topic)
		if err != nil || mode != "batch" || count < 1 {
			return fmt.Errorf("KAFKA_BATCH_TOPIC_PARTITIONS: %q must be a batch topic with a positive partition count", topic)
		}
	}
	c.batchTopicPartitions = counts
	return nil
}

func (c *Config) destinationTopicPartitions(topic string) int {
	return max(1, c.batchTopicPartitions[topic])
}

func validatePartitionExpansion(topic string, results []kafka.TopicResult) error {
	for _, result := range results {
		if result.Topic == topic {
			if result.Error.Code() != kafka.ErrNoError {
				return result.Error
			}
			return nil
		}
	}
	return fmt.Errorf("missing CreatePartitions result for %s", topic)
}

func (tm *TopicManager) expandBatchTopic(topic string, count int) error {
	results, err := tm.kaftaAdminClient.CreatePartitions(context.Background(), []kafka.PartitionsSpecification{{Topic: topic, IncreaseTo: count}})
	if err != nil {
		return err
	}
	if err = validatePartitionExpansion(topic, results); err != nil {
		// Another owner during a rolling deployment may have expanded the topic.
		metadata, metadataErr := tm.kaftaAdminClient.GetMetadata(&topic, false, tm.config.KafkaAdminMetadataTimeoutMs)
		if metadataErr == nil {
			if current, ok := metadata.Topics[topic]; ok && current.Error.Code() == kafka.ErrNoError && len(current.Partitions) >= count {
				return nil
			}
		}
		return err
	}
	tm.Infof("Expanded batch topic %s to %d partitions", topic, count)
	return nil
}
