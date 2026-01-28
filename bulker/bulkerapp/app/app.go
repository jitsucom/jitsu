package app

import (
	"context"
	"fmt"
	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jitsucom/bulker/bulkerapp/metrics"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"net/http"
	"runtime/debug"
	"time"
)

type Context struct {
	config              *Config
	kafkaConfig         *kafka.ConfigMap
	configurationSource ConfigurationSource
	repository          *Repository
	cron                *Cron
	batchProducer       *Producer
	streamProducer      *Producer
	eventsLogService    eventslog.EventsLogService
	topicManager        *TopicManager
	fastStore           *FastStore
	server              *http.Server
	metricsServer       *MetricsServer
	shardNumber         int
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}
	safego.GlobalRecoverHandler = func(value interface{}) {
		logging.Error("panic")
		logging.Error(value)
		logging.Error(string(debug.Stack()))
		metrics.Panics().Inc()
	}
	if err != nil {
		return err
	}

	a.shardNumber = a.config.InstanceIndex % a.config.ShardsCount

	a.configurationSource, err = InitConfigurationSource(a.config)
	if err != nil {
		return err
	}
	a.repository, err = NewRepository(a.config, a.configurationSource)
	if err != nil {
		return err
	}
	a.cron = NewCron(a.config)

	a.eventsLogService = &eventslog.DummyEventsLogService{}

	if a.config.ClickhouseURL != "" || a.config.ClickhouseHost != "" {
		a.eventsLogService, err = eventslog.NewClickhouseEventsLog(a.config.EventsLogConfig)
		if err != nil {
			return err
		}
	} else if eventsLogRedisUrl := utils.NvlString(a.config.EventsLogRedisURL, a.config.RedisURL); eventsLogRedisUrl != "" {
		a.eventsLogService, err = eventslog.NewRedisEventsLog(eventsLogRedisUrl, a.config.RedisTLSCA, a.config.EventsLogMaxSize)
		if err != nil {
			return err
		}
	}

	a.fastStore, err = NewFastStore(a.config)
	if err != nil {
		return err
	}

	a.kafkaConfig = a.config.GetKafkaConfig()
	if a.kafkaConfig != nil {
		//batch producer uses higher linger.ms and doesn't suit for sync delivery used by stream consumer when retrying messages
		batchProducerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
			"queue.buffering.max.messages": a.config.ProducerQueueSize,
			"batch.size":                   a.config.ProducerBatchSize,
			"linger.ms":                    a.config.ProducerLingerMs,
			"compression.type":             a.config.KafkaTopicCompression,
		}, *a.kafkaConfig))
		a.batchProducer, err = NewProducer(&a.config.KafkaConfig, &batchProducerConfig, true)
		if err != nil {
			return err
		}
		a.batchProducer.Start()

		streamProducerConfig := kafka.ConfigMap(utils.MapPutAll(kafka.ConfigMap{
			"compression.type": a.config.KafkaTopicCompression,
		}, *a.kafkaConfig))
		a.streamProducer, err = NewProducer(&a.config.KafkaConfig, &streamProducerConfig, false)
		if err != nil {
			return err
		}
		a.streamProducer.Start()

		a.topicManager, err = NewTopicManager(a)
		if err != nil {
			return err
		}
		a.topicManager.Start()
	}

	router := NewRouter(a)
	a.server = &http.Server{
		Addr:        fmt.Sprintf(":%d", a.config.HTTPPort),
		Handler:     router.Engine(),
		ReadTimeout: time.Minute * 30,
		IdleTimeout: time.Minute * 5,
	}
	a.metricsServer = NewMetricsServer(a.config)
	return nil
}

func (a *Context) ShutdownSignal() error {
	logging.Infof("Shutting down http server...")
	_ = a.server.Shutdown(context.Background())
	return nil
}

// TODO: graceful shutdown and cleanups. Flush producer
func (a *Context) Cleanup() error {
	time.Sleep(2 * time.Second)
	a.cron.Close()
	_ = a.topicManager.Close()
	_ = a.repository.Close()
	_ = a.configurationSource.Close()
	_ = a.eventsLogService.Close()
	_ = a.fastStore.Close()
	_ = a.batchProducer.Close()
	_ = a.streamProducer.Close()
	if a.config.ShutdownExtraDelay > 0 {
		logging.Infof("Waiting %d seconds before http server shutdown...", a.config.ShutdownExtraDelay)
		time.Sleep(time.Duration(a.config.ShutdownExtraDelay) * time.Second)
	}
	_ = a.metricsServer.Stop()
	return nil
}

func (a *Context) Config() *Config {
	return a.config
}

func (a *Context) Server() *http.Server {
	return a.server
}
