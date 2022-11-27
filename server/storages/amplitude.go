package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//go:embed transform/amplitude.js
var amplitudeTransform string

// Amplitude is a destination that can send data into Amplitude
type Amplitude struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: AmplitudeType, createFunc: NewAmplitude, isSQL: false})
}

// NewAmplitude returns configured Amplitude destination
func NewAmplitude(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if !config.streamMode {
		return nil, fmt.Errorf("Amplitude destination doesn't support %s mode", BatchMode)
	}
	amplitudeConfig := &adapters.AmplitudeConfig{}
	if err = config.destination.GetDestConfig(config.destination.Amplitude, amplitudeConfig); err != nil {
		return
	}

	a := &Amplitude{}
	err = a.Init(config, a, amplitudeTransform, `return toAmplitude($)`)
	if err != nil {
		return
	}
	storage = a

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	aAdapter, err := adapters.NewAmplitude(amplitudeConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   a.ErrorEvent,
		SuccessHandler: a.SuccessEvent,
	})
	if err != nil {
		return
	}
	//HTTPStorage
	a.adapter = aAdapter

	//streaming worker (queue reading)
	a.streamingWorkers = newStreamingWorkers(config.eventQueue, a, config.streamingThreadsCount)
	return
}

// Type returns Amplitude type
func (a *Amplitude) Type() string {
	return AmplitudeType
}
