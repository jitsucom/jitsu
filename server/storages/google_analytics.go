package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//go:embed transform/google_analytics.js
var googleAnalyticsTransform string

// GoogleAnalytics stores events to Google Analytics in stream mode
type GoogleAnalytics struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: GoogleAnalyticsType, createFunc: NewGoogleAnalytics, isSQL: false})
}

// NewGoogleAnalytics return GoogleAnalytics instance
// start streaming worker goroutine
func NewGoogleAnalytics(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if !config.streamMode {
		return nil, fmt.Errorf("Google Analytics destination doesn't support %s mode", BatchMode)
	}
	gaConfig := &adapters.GoogleAnalyticsConfig{}
	if err = config.destination.GetDestConfig(config.destination.GoogleAnalytics, gaConfig); err != nil {
		return
	}

	ga := &GoogleAnalytics{}
	err = ga.Init(config, ga, googleAnalyticsTransform, `return toGoogleAnalytics($)`)
	if err != nil {
		return
	}
	storage = ga

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
		return
	}

	ga.adapter = gaAdapter

	//streaming worker (queue reading)
	ga.streamingWorkers = newStreamingWorkers(config.eventQueue, ga, config.streamingThreadsCount)
	return
}

// Type returns Google Analytics type
func (ga *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}
