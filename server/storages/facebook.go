package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//Facebook stores events to Facebook Conversion API in stream mode
type Facebook struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: FacebookType, createFunc: NewFacebook})
}

//NewFacebook returns configured Facebook destination
func NewFacebook(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Facebook destination doesn't support %s mode", BatchMode)
	}
	fbConfig := &adapters.FacebookConversionAPIConfig{}
	if err := config.destination.GetDestConfig(config.destination.Facebook, fbConfig); err != nil {
		return nil, err
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)

	fb := &Facebook{}

	fbAdapter, err := adapters.NewFacebookConversion(fbConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   fb.ErrorEvent,
		SuccessHandler: fb.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(fbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, FacebookType)

	fb.adapter = fbAdapter
	fb.tableHelper = tableHelper

	//Abstract (SQLAdapters and tableHelpers are omitted)
	fb.destinationID = config.destinationID
	fb.processor = config.processor
	fb.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	fb.eventsCache = config.eventsCache
	fb.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	fb.uniqueIDField = config.uniqueIDField
	fb.staged = config.destination.Staged
	fb.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	fb.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, fb, tableHelper)
	fb.streamingWorker.start()

	return fb, nil
}

//Type returns Facebook type
func (fb *Facebook) Type() string {
	return FacebookType
}
