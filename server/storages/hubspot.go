package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

//HubSpot is a destination that can send data into HubSpot
type HubSpot struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: HubSpotType, createFunc: NewHubSpot, defaultTableName: "$.user?.email", isSQL: false})
}

//NewHubSpot returns configured HubSpot destination
func NewHubSpot(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("HubSpot destination doesn't support %s mode", BatchMode)
	}

	hubspotConfig := &adapters.HubSpotConfig{}
	if err := config.destination.GetDestConfig(config.destination.HubSpot, hubspotConfig); err != nil {
		return nil, err
	}

	h := &HubSpot{}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	hAdapter, err := adapters.NewHubSpot(hubspotConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   h.ErrorEvent,
		SuccessHandler: h.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(hAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, HubSpotType)

	h.tableHelper = tableHelper
	h.adapter = hAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	h.destinationID = config.destinationID
	h.processor = config.processor
	h.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	h.eventsCache = config.eventsCache
	h.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	h.uniqueIDField = config.uniqueIDField
	h.staged = config.destination.Staged
	h.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	h.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, h, tableHelper)
	h.streamingWorker.start()

	return h, nil
}

//Type returns HubSpot type
func (h *HubSpot) Type() string {
	return HubSpotType
}
