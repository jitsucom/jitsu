package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"math"
)

//go:embed transform/facebook.js
var facebookTransform string

// Facebook stores events to Facebook Conversion API in stream mode
type Facebook struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: FacebookType, createFunc: NewFacebook, isSQL: false})
}

// NewFacebook returns configured Facebook destination
func NewFacebook(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if !config.streamMode {
		return nil, fmt.Errorf("Facebook destination doesn't support %s mode", BatchMode)
	}
	fbConfig := &adapters.FacebookConversionAPIConfig{}
	if err = config.destination.GetDestConfig(config.destination.Facebook, fbConfig); err != nil {
		return
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	fb := &Facebook{}
	err = fb.Init(config, fb, facebookTransform, `return toFacebook($)`)
	if err != nil {
		return
	}
	storage = fb

	fbAdapter, err := adapters.NewFacebookConversion(fbConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    int(math.Max(defaultWorkersPoolSize, float64(config.streamingThreadsCount))),
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   fb.ErrorEvent,
		SuccessHandler: fb.SuccessEvent,
	})
	if err != nil {
		return
	}

	fb.adapter = fbAdapter

	//streaming worker (queue reading)
	fb.streamingWorkers = newStreamingWorkers(config.eventQueue, fb, config.streamingThreadsCount)
	return
}

// Type returns Facebook type
func (fb *Facebook) Type() string {
	return FacebookType
}
