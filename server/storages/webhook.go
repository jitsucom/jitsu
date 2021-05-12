package storages

import (
	"errors"
	"fmt"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

const (
	WebHookType = "webhook"
)

type WebHook struct {
	name            string
	tableHelper     *TableHelper
	processor       *schema.Processor
	streamingWorker *StreamingWorker
	fallbackLogger  *logging.AsyncLogger
	eventsCache     *caching.EventsCache
	staged          bool
	whAdapter       *adapters.WebHookConversion
}

func NewWebHook(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("WebHook destination doesn't support %s mode", BatchMode)
	}

	webHookConfig := config.destination.WebHook
	if err := webHookConfig.Validate(); err != nil {
		return nil, err
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)
	wbAdapter, err := adapters.NewWebHookConversion(webHookConfig, requestDebugLogger)
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(wbAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToFacebookConversion, config.streamMode, 0)

	wh := &WebHook{
		name:           config.name,
		tableHelper:    tableHelper,
		whAdapter:      wbAdapter,
		processor:      config.processor,
		fallbackLogger: config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:    config.eventsCache,
		staged:         config.destination.Staged,
	}

	wh.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, wh, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelper)
	wh.whAdapter.RequestFailCallback = wh.RequestFailedCallback
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

func (wh *WebHook) Insert(table *adapters.Table, event events.Event) (err error) {
	return wh.whAdapter.Send(event)
}

func (wh *WebHook) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, wh.processor, wh.tableHelper)
}

func (wh *WebHook) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error) {
	return nil, 0, errors.New("WebHook Conversion doesn't support Store() func")
}

func (wh *WebHook) StoreWithParseFunc(fileName string, payload []byte, skipTables map[string]bool, parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error) {
	return nil, 0, errors.New("WebHook Conversion doesn't support Store() func")
}

func (wh *WebHook) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) (int, error) {
	return 0, errors.New("WebHook Conversion doesn't support Store() func")
}

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

func (wh *WebHook) Type() string {
	return WebHookType
}

func (wh *WebHook) IsStaging() bool {
	return wh.staged
}

func (wh *WebHook) Name() string {
	return wh.name
}

func (wh *WebHook) Close() (multiErr error) {
	if err := wh.whAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing WebHook client: %v", wh.Name(), err))
	}

	if wh.streamingWorker != nil {
		if err := wh.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", wh.Name(), err))
		}
	}

	if err := wh.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", wh.Name(), err))
	}

	return
}
