package storages

import (
	"errors"
	"fmt"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//GoogleAnalytics stores events to Google Analytics in stream mode
type GoogleAnalytics struct {
	name            string
	gaAdapter       *adapters.GoogleAnalytics
	tableHelper     *TableHelper
	processor       *schema.Processor
	streamingWorker *StreamingWorker
	fallbackLogger  *logging.AsyncLogger
	eventsCache     *caching.EventsCache
	staged          bool
}

func init() {
	RegisterStorage(GoogleAnalyticsType, NewGoogleAnalytics)
}

//NewGoogleAnalytics return GoogleAnalytics instance
//start streaming worker goroutine
func NewGoogleAnalytics(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Google Analytics destination doesn't support %s mode", BatchMode)
	}

	gaConfig := config.destination.GoogleAnalytics
	if err := gaConfig.Validate(); err != nil {
		return nil, err
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	gaAdapter := adapters.NewGoogleAnalytics(gaConfig, requestDebugLogger)

	tableHelper := NewTableHelper(gaAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToGoogleAnalytics, config.streamMode, 0)

	ga := &GoogleAnalytics{
		name:           config.destinationID,
		gaAdapter:      gaAdapter,
		tableHelper:    tableHelper,
		processor:      config.processor,
		fallbackLogger: config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:    config.eventsCache,
		staged:         config.destination.Staged,
	}

	ga.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ga, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
	ga.streamingWorker.start()

	return ga, nil
}

func (ga *GoogleAnalytics) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, ga.processor, ga.tableHelper)
}

func (ga *GoogleAnalytics) Insert(table *adapters.Table, event events.Event) (err error) {
	return ga.gaAdapter.Send(event)
}

func (ga *GoogleAnalytics) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("GoogleAnalytics doesn't support Store() func")
}

func (ga *GoogleAnalytics) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("GoogleAnalytics doesn't support SyncStore() func")
}

func (ga *GoogleAnalytics) Update(object map[string]interface{}) error {
	return errors.New("GoogleAnalytics doesn't support updates")
}

func (ga *GoogleAnalytics) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Fallback log event with error to fallback logger
func (ga *GoogleAnalytics) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		ga.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (ga *GoogleAnalytics) ID() string {
	return ga.name
}

func (ga *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}

func (ga *GoogleAnalytics) IsStaging() bool {
	return ga.staged
}

func (ga *GoogleAnalytics) Close() (multiErr error) {
	if err := ga.gaAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing GoogleAnalytics client: %v", ga.ID(), err))
	}

	if ga.streamingWorker != nil {
		if err := ga.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ga.ID(), err))
		}
	}

	if err := ga.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", ga.ID(), err))
	}

	return
}
