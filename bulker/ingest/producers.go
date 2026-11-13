package main

import (
	"sync"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/kafkabase"
)

// A full backup or observability queue must never prevent pipeline admission.
// Only the pipeline producer owns failover files: background records cannot be
// replayed through the functions pipeline and must not share its logger paths.
func (a *Context) initProducers() (err error) {
	defer func() {
		if err != nil {
			a.closeProducers()
		}
	}()
	for _, spec := range []struct {
		name                   string
		target                 **kafkabase.Producer
		maxMessages, maxKBytes int
		failover               bool
	}{
		{"pipeline", &a.producer, a.config.ProducerQueueSize, a.config.ProducerQueueSizeKB, true},
		{"backup", &a.backupProducer, a.config.BackupProducerQueueSize, a.config.BackupProducerQueueSizeKB, false},
		{"telemetry", &a.telemetryProducer, a.config.TelemetryProducerQueueSize, a.config.TelemetryProducerQueueSizeKB, false},
	} {
		config := a.config.KafkaConfig
		if !spec.failover {
			config.FailoverLoggerEnabled = false
		}
		clientConfig := kafka.ConfigMap{}
		for key, value := range *a.kafkaConfig {
			clientConfig[key] = value
		}
		clientConfig["queue.buffering.max.messages"] = spec.maxMessages
		clientConfig["queue.buffering.max.kbytes"] = spec.maxKBytes
		clientConfig["batch.size"] = config.ProducerBatchSize
		clientConfig["linger.ms"] = config.ProducerLingerMs
		clientConfig["compression.type"] = config.KafkaTopicCompression
		clientConfig["delivery.timeout.ms"] = config.ProducerDeliveryTimeoutMs
		*spec.target, err = kafkabase.NewNamedProducer(spec.name, &config, &clientConfig, true, nil)
		if err != nil {
			return err
		}
		(*spec.target).Start()
	}
	return nil
}

func (a *Context) closeProducers() {
	// Start every flush immediately; a blocked background producer must not delay
	// the pipeline flush or multiply the configured shutdown timeout.
	var wg sync.WaitGroup
	for _, producer := range []*kafkabase.Producer{a.producer, a.backupProducer, a.telemetryProducer} {
		wg.Go(func() { _ = producer.Close() })
	}
	wg.Wait()
}
