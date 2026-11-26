package main

import (
	"context"
	"fmt"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/hjson/hjson-go/v4"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"os"
)

// add partitions to the topic
func kafka1() {
	bootstapServers := os.Getenv("KAFKA_BOOTSTRAP_SERVERS")
	securityProtocol := os.Getenv("KAFKA_SECURITY_PROTOCOL")
	kafkaSasl := os.Getenv("KAFKA_SASL")
	fmt.Println("Kafka bootstrap servers:", bootstapServers, "security protocol:", securityProtocol, "kafka sasl:", kafkaSasl)
	kafkaConfig := &kafka.ConfigMap{
		"client.id":                "bulkerapp_admin",
		"bootstrap.servers":        bootstapServers,
		"reconnect.backoff.ms":     1000,
		"reconnect.backoff.max.ms": 10000,
	}
	if securityProtocol != "" {
		_ = kafkaConfig.SetKey("security.protocol", securityProtocol)
		_ = kafkaConfig.SetKey("enable.ssl.certificate.verification", false)
	}
	if kafkaSasl != "" {
		sasl := map[string]interface{}{}
		err := hjson.Unmarshal([]byte(kafkaSasl), &sasl)
		if err != nil {
			panic(fmt.Errorf("error parsing Kafka SASL config: %s", utils.DescribeConfigError(err)))
		}
		for k, v := range sasl {
			_ = kafkaConfig.SetKey("sasl."+k, v)
		}
	}
	admin, err := kafka.NewAdminClient(kafkaConfig)
	if err != nil {
		panic(fmt.Errorf("error creating Kafka admin client: %v", err))
	}
	m, err := admin.GetMetadata(nil, true, 10000)
	if err != nil {
		panic(fmt.Errorf("error getting Kafka metadata: %v", err))
	}
	fmt.Println(m.Brokers)
	fmt.Print("Enter topic name to increase partitions: ")
	var topic string
	_, err = fmt.Scanln(&topic)
	if err != nil {
		panic(fmt.Errorf("error reading topic name: %v", err))
	}
	fmt.Printf("Enter new number of partitions for topic '%s': ", topic)
	var partitions int
	_, err = fmt.Scanln(&partitions)
	if err != nil {
		panic(fmt.Errorf("error reading partitions number: %v", err))
	}
	res, err := admin.CreatePartitions(context.Background(), []kafka.PartitionsSpecification{
		{
			Topic:      topic,
			IncreaseTo: partitions,
		},
	})
	if err != nil {
		panic(fmt.Errorf("error creating partitions: %v", err))
	}
	fmt.Println(res)
}
