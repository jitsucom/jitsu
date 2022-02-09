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
	err := h.Init(config)
	if err != nil {
		return nil, err
	}

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

	h.adapter = hAdapter

	//streaming worker (queue reading)
	h.streamingWorker = newStreamingWorker(config.eventQueue, h)
	return h, nil
}

//Type returns HubSpot type
func (h *HubSpot) Type() string {
	return HubSpotType
}
