package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/schema"
)

//HubSpot is a destination that can send data into HubSpot
type HubSpot struct {
	Abstract

	tableHelper          *TableHelper
	streamingWorker      *StreamingWorker
	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration
	hubspotAdapter       *adapters.HubSpot
}

func init() {
	RegisterStorage(HubSpotType, NewHubSpot)
}

//NewHubSpot returns configured HubSpot destination
func NewHubSpot(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("HubSpot destination doesn't support %s mode", BatchMode)
	}

	hubspotConfig := config.destination.HubSpot
	if err := hubspotConfig.Validate(); err != nil {
		return nil, err
	}

	h := &HubSpot{
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	hAdapter, err := adapters.NewHubSpot(hubspotConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   h.ErrorEvent,
		SuccessHandler: h.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(hAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0)

	h.tableHelper = tableHelper
	h.hubspotAdapter = hAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	h.destinationID = config.destinationID
	h.processor = config.processor
	h.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	h.eventsCache = config.eventsCache
	h.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	//streaming worker (queue reading)
	h.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, h, tableHelper)
	h.streamingWorker.start()

	return h, nil
}

//Insert sends event into adapters.HTTPAdapter
func (h *HubSpot) Insert(eventContext *adapters.EventContext) error {
	return h.hubspotAdapter.Insert(eventContext)
}

func (h *HubSpot) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, h.processor, h.tableHelper)
}

//Store isn't supported
func (h *HubSpot) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("HubSpot doesn't support Store() func")
}

//SyncStore isn't supported
func (h *HubSpot) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return errors.New("HubSpot doesn't support Store() func")
}

//Update isn't supported
func (h *HubSpot) Update(object map[string]interface{}) error {
	return errors.New("HubSpot doesn't support Store() func")
}

//GetUsersRecognition returns users recognition configuration
func (h *HubSpot) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (h *HubSpot) GetUniqueIDField() *identifiers.UniqueID {
	return h.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (h *HubSpot) IsCachingDisabled() bool {
	return h.cachingConfiguration != nil && h.cachingConfiguration.Disabled
}

//Type returns HubSpot type
func (h *HubSpot) Type() string {
	return HubSpotType
}

func (h *HubSpot) IsStaging() bool {
	return h.staged
}

//Close closes HubSpot adapter, fallback logger and streaming worker
func (h *HubSpot) Close() (multiErr error) {
	if err := h.hubspotAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing HubSpot adapter: %v", h.ID(), err))
	}

	if h.streamingWorker != nil {
		if err := h.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", h.ID(), err))
		}
	}

	if err := h.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
