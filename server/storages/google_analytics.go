package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/templates"
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

	es5transform, err := templates.Babelize(googleAnalyticsTransform)
	if err != nil {
		return nil, fmt.Errorf("failed to convert transformation code to es5: %v", err)
	}
	config.processor.AddJavaScript(es5transform)
	config.processor.SetDefaultTransform(`return toGoogleAnalytics($)`)

	gaConfig := &adapters.GoogleAnalyticsConfig{}
	if err := config.destination.GetDestConfig(config.destination.GoogleAnalytics, gaConfig); err != nil {
		return nil, err
	}

	ga := &GoogleAnalytics{}

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

	tableHelper := NewTableHelper(gaAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, GoogleAnalyticsType)

	ga.adapter = gaAdapter
	ga.tableHelper = tableHelper

	//Abstract (SQLAdapters and tableHelpers are omitted)
	ga.destinationID = config.destinationID
	ga.processor = config.processor
	ga.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	ga.eventsCache = config.eventsCache
	ga.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	ga.uniqueIDField = config.uniqueIDField
	ga.staged = config.destination.Staged
	ga.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	ga.streamingWorker, err = newStreamingWorker(config.eventQueue, config.processor, ga, tableHelper)
	if err != nil {
		return nil, err
	}
	ga.streamingWorker.start()

	return ga, nil
}

//Type returns Google Analytics type
func (ga *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}
