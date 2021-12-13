package storages

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/schema"
)

//HTTPStorage is an abstract destination storage for HTTP destinations
//contains common HTTP destination funcs
//aka abstract class
type HTTPStorage struct {
	Abstract

	tableHelper     *TableHelper
	streamingWorker *StreamingWorker

	adapter adapters.Adapter
}

//Insert sends event into adapters.Adapter
func (h *HTTPStorage) Insert(eventContext *adapters.EventContext) error {
	return h.adapter.Insert(eventContext)
}

func (h *HTTPStorage) DryRun(payload events.Event) ([][]adapters.TableField, error) {
	return dryRun(payload, h.processor, h.tableHelper)
}

//Store isn't supported
func (h *HTTPStorage) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	return nil, nil, nil, fmt.Errorf("%s doesn't support Store() func", h.Type())
}

//SyncStore isn't supported
func (h *HTTPStorage) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return fmt.Errorf("%s doesn't support Store() func", h.Type())
}

//Update isn't supported
func (h *HTTPStorage) Update(objects []map[string]interface{}) error {
	return fmt.Errorf("%s doesn't support Store() func", h.Type())
}

//GetUsersRecognition returns disabled users recognition configuration
func (h *HTTPStorage) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (h *HTTPStorage) GetUniqueIDField() *identifiers.UniqueID {
	return h.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (h *HTTPStorage) IsCachingDisabled() bool {
	return h.cachingConfiguration != nil && h.cachingConfiguration.Disabled
}

//Type returns storage type. Should be overridden in every implementation
func (h *HTTPStorage) Type() string {
	return "HTTPStorage"
}

//Close closes adapter, fallback logger and streaming worker
func (h *HTTPStorage) Close() (multiErr error) {
	if err := h.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing %s client: %v", h.ID(), h.Type(), err))
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
