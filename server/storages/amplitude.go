package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//Amplitude is a destination that can send data into Amplitude
type Amplitude struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: AmplitudeType, createFunc: NewAmplitude})
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

	tableHelper := NewTableHelper(aAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, AmplitudeType)

	//HTTPStorage
	a.tableHelper = tableHelper
	a.adapter = aAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	a.destinationID = config.destinationID
	a.processor = config.processor
	a.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	a.eventsCache = config.eventsCache
	a.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	a.uniqueIDField = config.uniqueIDField
	a.staged = config.destination.Staged
	a.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	a.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, a, tableHelper)
	a.streamingWorker.start()

	return a, nil
}

//Type returns Amplitude type
func (a *Amplitude) Type() string {
	return AmplitudeType
}
