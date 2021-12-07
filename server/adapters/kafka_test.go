package adapters

import (
	"context"
	"fmt"
	"github.com/Shopify/sarama"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"log"
	"math/rand"
	"os"
	"testing"
)

func init() {
	fmt.Println("overriding sarama logger")
	sarama.Logger = log.New(os.Stdout, "[Sarama] ", log.LstdFlags)

}

func TestKafkaBulkInsert(t *testing.T) {
	kafkaCluster, err := test.NewKafkaCluster(context.Background())
	require.NoError(t, err)
	defer kafkaCluster.Close()
	kafkaConfig := &KafkaConfig{
		BootstrapServers: []string{kafkaCluster.BootstrapServer},
		Topic:            "test_kafka_bulk_insert",
		AuthType:         KafkaAuthNone,
	}
	kafkaAdapter, err := NewKafka(kafkaConfig)
	require.NoError(t, err)
	defer kafkaAdapter.Close()
	table := kafkaTestTable(kafkaConfig.Topic)
	inputObjects := createObjectsForKafka(5, kafkaTestTableRecord)
	for i := 0; i < 10; i += 1 {
		err = kafkaAdapter.BulkInsert(table, inputObjects)
		if err == nil {
			break
		}
	}
	require.NoError(t, err, "could not send messages to topic "+table.Name)
	err = kafkaCluster.Contains(t, table.Name, inputObjects)
	require.NoError(t, err, "could not fetch messages from topic "+table.Name)
}

func TestKafkaBulkUpdate(t *testing.T) {
	kafkaCluster, err := test.NewKafkaCluster(context.Background())
	require.NoError(t, err)
	defer kafkaCluster.Close()
	kafkaConfig := &KafkaConfig{
		BootstrapServers: []string{kafkaCluster.BootstrapServer},
		Topic:            "test_kafka_bulk_update",
		AuthType:         KafkaAuthNone,
	}
	kafkaAdapter, err := NewKafka(kafkaConfig)
	require.NoError(t, err)
	defer kafkaAdapter.Close()
	table := kafkaTestTable(kafkaConfig.Topic)
	inputObjects := createObjectsForKafka(5, kafkaTestTableRecord)
	for i := 0; i < 10; i += 1 {
		err = kafkaAdapter.BulkUpdate(table, inputObjects, nil)
		if err == nil {
			break
		}
	}
	require.NoError(t, err, "could not send messages to topic "+table.Name)
	err = kafkaCluster.Contains(t, table.Name, inputObjects)
	require.NoError(t, err, "could not fetch messages from topic "+table.Name)
}

func TestKafkaInsert(t *testing.T) {
	kafkaCluster, err := test.NewKafkaCluster(context.Background())
	require.NoError(t, err)
	defer kafkaCluster.Close()
	kafkaConfig := &KafkaConfig{
		BootstrapServers: []string{kafkaCluster.BootstrapServer},
		Topic:            "test_kafka_insert",
		AuthType:         KafkaAuthNone,
	}
	kafkaAdapter, err := NewKafka(kafkaConfig)
	require.NoError(t, err)
	defer kafkaAdapter.Close()
	event := &EventContext{
		Table:          kafkaTestTable(kafkaConfig.Topic),
		ProcessedEvent: kafkaTestTableRecord(0),
	}
	for i := 0; i < 10; i += 1 {
		err = kafkaAdapter.Insert(event)
		if err == nil {
			break
		}
	}
	require.NoError(t, err, "could not send messages to topic "+event.Table.Name)
	err = kafkaCluster.Contains(t, event.Table.Name, []map[string]interface{}{event.ProcessedEvent})
	require.NoError(t, err, "could not fetch messages from topic "+event.Table.Name)
}

func kafkaTestTable(name string) *Table {
	return &Table{
		Name: name,
		//Name: fmt.Sprintf("test_kafka_bulk_update_%d", rand.Int()),
		Columns: Columns{
			"field1": typing.SQLColumn{Type: "str"},
			"field2": typing.SQLColumn{Type: "str"},
			"field3": typing.SQLColumn{Type: "bool"},
			"user":   typing.SQLColumn{Type: "str"},
		},
	}
}

func kafkaTestTableRecord(id int) map[string]interface{} {
	return map[string]interface{}{
		"field1": fmt.Sprintf("100000-%d", id),
		"field2": fmt.Sprint(rand.Intn(100)),
		"field3": rand.Intn(100)%2 == 0,
		"user":   fmt.Sprintf("test-%d", rand.Intn(100)),
	}
}

func createObjectsForKafka(num int, generate func(int) map[string]interface{}) []map[string]interface{} {
	var objects []map[string]interface{}
	for i := 0; i < num; i++ {
		object := generate(i)
		objects = append(objects, object)
	}
	return objects
}
