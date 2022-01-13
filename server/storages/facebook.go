package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/templates"
)

//go:embed transform/facebook.js
var facebookTransform string

//Facebook stores events to Facebook Conversion API in stream mode
type Facebook struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: FacebookType, createFunc: NewFacebook, isSQL: false})
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

	es5transform, err := templates.Babelize(facebookTransform)
	if err != nil {
		return nil, fmt.Errorf("failed to convert transformation code to es5: %v", err)
	}
	config.processor.AddJavaScript(es5transform)
	config.processor.SetDefaultUserTransform(`return toFacebook($)`)

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

	tableHelper := NewTableHelper("", fbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, FacebookType)

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
	fb.streamingWorker, err = newStreamingWorker(config.eventQueue, config.processor, fb, tableHelper)
	if err != nil {
		return nil, err
	}
	fb.streamingWorker.start()

	return fb, nil
}

//Type returns Facebook type
func (fb *Facebook) Type() string {
	return FacebookType
}
