package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"net/http"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
)

const defaultWorkersPoolSize = 10

//DefaultHTTPConfiguration contains default HTTP timeouts/retry/delays,etc for HTTPAdapters
var DefaultHTTPConfiguration = &adapters.HTTPConfiguration{
	GlobalClientTimeout:       10 * time.Second,
	RetryDelay:                3 * time.Second,
	RetryCount:                3,
	ClientMaxIdleConns:        1000,
	ClientMaxIdleConnsPerHost: 1000,
}

//WebHook is a destination that can send configurable HTTP requests
type WebHook struct {
	Abstract

	tableHelper          *TableHelper
	processor            *schema.Processor
	streamingWorker      *StreamingWorker
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

	wh := &WebHook{
		processor:            config.processor,
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	wbAdapter, err := adapters.NewWebHook(webHookConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   wh.ErrorEvent,
		SuccessHandler: wh.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(wbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, config.streamMode, 0)

	wh.tableHelper = tableHelper
	wh.whAdapter = wbAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	wh.destinationID = config.destinationID
	wh.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	wh.eventsCache = config.eventsCache
	wh.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	wh.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, wh, tableHelper)
	wh.streamingWorker.start()

	return wh, nil
}

//Insert sends event into adapters.HTTPAdapter
func (wh *WebHook) Insert(eventContext *adapters.EventContext) error {
	return wh.whAdapter.Insert(eventContext)
}

func (wh *WebHook) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, wh.processor, wh.tableHelper)
}

//Store isn't supported
func (wh *WebHook) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("WebHook doesn't support Store() func")
}

//SyncStore isn't supported
func (wh *WebHook) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("WebHook doesn't support Store() func")
}

//Update isn't supported
func (wh *WebHook) Update(object map[string]interface{}) error {
	return errors.New("WebHook doesn't support Store() func")
}

//GetUsersRecognition returns users recognition configuration
func (wh *WebHook) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (wh *WebHook) GetUniqueIDField() *identifiers.UniqueID {
	return wh.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (wh *WebHook) IsCachingDisabled() bool {
	return wh.cachingConfiguration != nil && wh.cachingConfiguration.Disabled
}

//Type returns WebHook type
func (wh *WebHook) Type() string {
	return WebHookType
}

func (wh *WebHook) IsStaging() bool {
	return wh.staged
}

//Close closes WebHook adapter, fallback logger and streaming worker
func (wh *WebHook) Close() (multiErr error) {
	if err := wh.whAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing WebHook adapter: %v", wh.ID(), err))
	}

	if wh.streamingWorker != nil {
		if err := wh.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", wh.ID(), err))
		}
	}

	if err := wh.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
