package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//go:embed transform/google_analytics.js
var googleAnalyticsTransform string

//GoogleAnalytics stores events to Google Analytics in stream mode
type GoogleAnalytics struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: GoogleAnalyticsType, createFunc: NewGoogleAnalytics, isSQL: false})
}

//NewGoogleAnalytics return GoogleAnalytics instance
//start streaming worker goroutine
func NewGoogleAnalytics(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Google Analytics destination doesn't support %s mode", BatchMode)
	}
	gaConfig := &adapters.GoogleAnalyticsConfig{}
	if err := config.destination.GetDestConfig(config.destination.GoogleAnalytics, gaConfig); err != nil {
		return nil, err
	}

	ga := &GoogleAnalytics{}
	err := ga.Init(config, ga)
	if err != nil {
		return nil, err
	}
	ga.processor.AddJavaScript(googleAnalyticsTransform)
	ga.processor.SetDefaultUserTransform(`return toGoogleAnalytics($)`)

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	gaAdapter, err := adapters.NewGoogleAnalytics(gaConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   ga.ErrorEvent,
		SuccessHandler: ga.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	ga.adapter = gaAdapter

	//streaming worker (queue reading)
	ga.streamingWorker = newStreamingWorker(config.eventQueue, ga)
	return ga, nil
}

//Type returns Google Analytics type
func (ga *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}
