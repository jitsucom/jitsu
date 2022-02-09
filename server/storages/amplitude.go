package storages

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//go:embed transform/amplitude.js
var amplitudeTransform string

//Amplitude is a destination that can send data into Amplitude
type Amplitude struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: AmplitudeType, createFunc: NewAmplitude, isSQL: false})
}

//NewAmplitude returns configured Amplitude destination
func NewAmplitude(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Amplitude destination doesn't support %s mode", BatchMode)
	}
	amplitudeConfig := &adapters.AmplitudeConfig{}
	if err := config.destination.GetDestConfig(config.destination.Amplitude, amplitudeConfig); err != nil {
		return nil, err
	}

	a := &Amplitude{}
	err := a.Init(config)
	if err != nil {
		return nil, err
	}

	a.processor.AddJavaScript(amplitudeTransform)
	a.processor.SetDefaultUserTransform(`return toAmplitude($)`)

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
		return nil, err
	}
	//HTTPStorage
	a.adapter = aAdapter

	//streaming worker (queue reading)
	a.streamingWorker = newStreamingWorker(config.eventQueue, a)
	return a, nil
}

//Type returns Amplitude type
func (a *Amplitude) Type() string {
	return AmplitudeType
}
