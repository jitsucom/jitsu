package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
)

// HubSpot is a destination that can send data into HubSpot
type HubSpot struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: HubSpotType, createFunc: NewHubSpot, defaultTableName: "$.user?.email", isSQL: false})
}

// NewHubSpot returns configured HubSpot destination
func NewHubSpot(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if !config.streamMode {
		return nil, fmt.Errorf("HubSpot destination doesn't support %s mode", BatchMode)
	}

	hubspotConfig := &adapters.HubSpotConfig{}
	if err = config.destination.GetDestConfig(config.destination.HubSpot, hubspotConfig); err != nil {
		return
	}

	h := &HubSpot{}
	err = h.Init(config, h, "", "")
	if err != nil {
		return
	}
	storage = h

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
		return
	}

	h.adapter = hAdapter

	//streaming worker (queue reading)
	h.streamingWorkers = newStreamingWorkers(config.eventQueue, h, config.streamingThreadsCount)
	return
}

// Type returns HubSpot type
func (h *HubSpot) Type() string {
	return HubSpotType
}
