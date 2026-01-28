package main

import (
	"context"
	"fmt"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
	"net/http"
	"time"
)

type Context struct {
	config           *Config
	kafkaConfig      *kafka.ConfigMap
	repository       appbase.Repository[Streams]
	scriptRepository appbase.Repository[Script]
	producer         *kafkabase.Producer
	eventsLogService eventslog.EventsLogService
	server           *http.Server
	metricsServer    *MetricsServer
	backupsLogger    *BackupLogger
	consumerMonitor  *ConsumerMonitor
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}
	a.repository = NewStreamsRepository(a.config.RepositoryURL, a.config.RepositoryAuthToken, a.config.RepositoryRefreshPeriodSec, a.config.CacheDir)
	a.scriptRepository = NewScriptRepository(a.config.ScriptOrigin, a.config.CacheDir)
	a.eventsLogService = &eventslog.DummyEventsLogService{}
	if a.config.ClickhouseURL != "" || a.config.ClickhouseHost != "" {
		a.eventsLogService, err = eventslog.NewClickhouseEventsLog(a.config.EventsLogConfig)
		if err != nil {
			return err
		}
	} else if a.config.RedisURL != "" {
		a.eventsLogService, err = eventslog.NewRedisEventsLog(a.config.RedisURL, a.config.RedisTLSCA, a.config.EventsLogMaxSize)
		if err != nil {
			return err
		}
	}
	a.kafkaConfig = a.config.GetKafkaConfig()
	//batch producer uses higher linger.ms and doesn't suit for sync delivery used by stream consumer when retrying messages
	producerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
		"queue.buffering.max.messages": a.config.ProducerQueueSize,
		"batch.size":                   a.config.ProducerBatchSize,
		"linger.ms":                    a.config.ProducerLingerMs,
		"compression.type":             a.config.KafkaTopicCompression,
	}, *a.kafkaConfig))
	var partitionSelector kafkabase.PartitionSelector = &kafkabase.DummyPartitionSelector{}
	if a.config.WeightedPartitionSelectorLagThreshold > 0 {
		a.consumerMonitor, err = NewConsumerMonitor(a, a.config.KafkaDestinationsTopicName, "rotor")
		if err != nil {
			return err
		}
		partitionSelector = a.consumerMonitor
	}
	a.producer, err = kafkabase.NewProducer(&a.config.KafkaConfig, &producerConfig, true, nil)
	if err != nil {
		return err
	}
	a.producer.Start()

	a.backupsLogger = NewBackupLogger(a.config)
	router := NewRouter(a, partitionSelector)
	a.server = &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", a.config.HTTPPort),
		Handler:           router.Engine(),
		ReadTimeout:       time.Second * 5,
		ReadHeaderTimeout: time.Second * 5,
		IdleTimeout:       time.Second * 65,
	}
	a.metricsServer = NewMetricsServer(a.config)
	return nil
}

func (a *Context) Cleanup() error {
	_ = a.producer.Close()
	if a.consumerMonitor != nil {
		_ = a.consumerMonitor.Close()
	}
	_ = a.backupsLogger.Close()
	if a.config.ShutdownExtraDelay > 0 {
		logging.Infof("Waiting %d seconds before http server shutdown...", a.config.ShutdownExtraDelay)
		time.Sleep(time.Duration(a.config.ShutdownExtraDelay) * time.Second)
	}
	_ = a.metricsServer.Stop()
	_ = a.eventsLogService.Close()
	_ = a.scriptRepository.Close()
	a.repository.Close()
	return nil
}

func (a *Context) ShutdownSignal() error {
	a.server.SetKeepAlivesEnabled(false)
	_ = a.server.Shutdown(context.Background())
	return nil
}

func (a *Context) Server() *http.Server {
	return a.server
}

func (a *Context) Config() *Config {
	return a.config
}
