package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/typing"
	"net/http"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

const defaultWorkersPoolSize = 10

var defaultHTTPConfiguration = &adapters.HTTPConfiguration{
	GlobalClientTimeout:       10 * time.Second,
	RetryDelay:                3 * time.Second,
	RetryCount:                3,
	ClientMaxIdleConns:        1000,
	ClientMaxIdleConnsPerHost: 1000,
}

//WebHook is a destination that can send configurable HTTP requests
type WebHook struct {
	destinationID        string
	tableHelper          *TableHelper
	processor            *schema.Processor
	streamingWorker      *StreamingWorker
	fallbackLogger       *logging.AsyncLogger
	eventsCache          *caching.EventsCache
	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration
	whAdapter            *adapters.WebHook
}

func init() {
	RegisterStorage(WebHookType, NewWebHook)
}

//NewWebHook returns configured WebHook destination
func NewWebHook(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("WebHook destination doesn't support %s mode", BatchMode)
	}

	webHookConfig := config.destination.WebHook
	if err := webHookConfig.Validate(); err != nil {
		return nil, err
	}

	//default GET HTTP method
	if webHookConfig.Method == "" {
		webHookConfig.Method = http.MethodGet
	}

	if webHookConfig.Headers == nil {
		webHookConfig.Headers = map[string]string{}
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	wbAdapter, err := adapters.NewWebHook(config.destinationID, config.logEventPath, webHookConfig, defaultHTTPConfiguration, defaultWorkersPoolSize, fallbackFunc, requestDebugLogger)
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(wbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, config.streamMode, 0)

	wh := &WebHook{
		destinationID:  config.destinationID,
		tableHelper:    tableHelper,
		whAdapter:      wbAdapter,
		processor:      config.processor,
		fallbackLogger: config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:    config.eventsCache,
		staged:         config.destination.Staged,
	}

	wh.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, wh, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
	wh.streamingWorker.start()

	return wh, nil
}

func (wh *WebHook) RequestFailedCallback(object map[string]interface{}, err error) {
	wh.Fallback(&events.FailedEvent{
		Event:   []byte(events.Event(object).Serialize()),
		Error:   err.Error(),
		EventID: events.ExtractEventID(object),
	})
	counters.ErrorEvents(wh.Name(), 1)
	wh.eventsCache.Error(wh.Name(), events.ExtractEventID(object), err.Error())
}

//Insert sends event into HTTP adapter
func (wh *WebHook) Insert(table *adapters.Table, event events.Event) (err error) {
	return wh.whAdapter.Send(event)
}

func (wh *WebHook) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, wh.processor, wh.tableHelper)
}

//Store isn't supported
func (wh *WebHook) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("WebHook Conversion doesn't support Store() func")
}

//SyncStore isn't supported
func (wh *WebHook) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("WebHook Conversion doesn't support Store() func")
}

//Update isn't supported
func (wh *WebHook) Update(object map[string]interface{}) error {
	return errors.New("WebHook Conversion doesn't support Store() func")
}

func (wh *WebHook) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		wh.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (wh *WebHook) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

func (wh *WebHook) GetUniqueIDField() *identifiers.UniqueID {
	return wh.uniqueIDField
}

func (wh *WebHook) IsCachingDisabled() bool {
	return wh.cachingConfiguration != nil && wh.cachingConfiguration.Disabled
}

func (wh *WebHook) Type() string {
	return WebHookType
}

func (wh *WebHook) IsStaging() bool {
	return wh.staged
}

func (wh *WebHook) ID() string {
	return wh.destinationID
}

func (wh *WebHook) Close() (multiErr error) {
	if err := wh.whAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing WebHook client: %v", wh.ID(), err))
	}

	if wh.streamingWorker != nil {
		if err := wh.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", wh.ID(), err))
		}
	}

	if err := wh.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", wh.ID(), err))
	}

	return
}
