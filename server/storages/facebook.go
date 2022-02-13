package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
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
	fb := &Facebook{}
	err := fb.Init(config, fb)
	if err != nil {
		return nil, err
	}
	fb.processor.AddJavaScript(facebookTransform)
	fb.processor.SetDefaultUserTransform(`return toFacebook($)`)

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

	fb.adapter = fbAdapter

	//streaming worker (queue reading)
	fb.streamingWorker = newStreamingWorker(config.eventQueue, fb)
	return fb, nil
}

//Type returns Facebook type
func (fb *Facebook) Type() string {
	return FacebookType
}
