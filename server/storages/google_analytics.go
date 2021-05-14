package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
)

//GoogleAnalytics stores events to Google Analytics in stream mode
type GoogleAnalytics struct {
	Abstract

	gaAdapter            *adapters.GoogleAnalytics
	tableHelper          *TableHelper
	processor            *schema.Processor
	streamingWorker      *StreamingWorker
	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration
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

	ga := &GoogleAnalytics{
		processor:            config.processor,
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	gaAdapter, err := adapters.NewGoogleAnalytics(gaConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   ga.ErrorEvent,
		SuccessHandler: ga.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(gaAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, config.streamMode, 0)

	ga.gaAdapter = gaAdapter
	ga.tableHelper = tableHelper

	//Abstract (SQLAdapters and tableHelpers are omitted)
	ga.destinationID = config.destinationID
	ga.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	ga.eventsCache = config.eventsCache
	ga.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	ga.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ga, tableHelper)
	ga.streamingWorker.start()

	return ga, nil
}

func (ga *GoogleAnalytics) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, ga.processor, ga.tableHelper)
}

//Insert sends event to Google Analytics
//uses errCallback under the hood (in adapters.HTTPAdapter)
func (ga *GoogleAnalytics) Insert(eventContext *adapters.EventContext) error {
	err := ga.gaAdapter.Insert(eventContext)

	//metrics/counters/cache/fallback
	ga.AccountResult(eventContext, err)

	return err
}

//Store isn't supported
func (ga *GoogleAnalytics) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("GoogleAnalytics doesn't support Store() func")
}

//SyncStore isn't supported
func (ga *GoogleAnalytics) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("GoogleAnalytics doesn't support SyncStore() func")
}

//Update isn't supported
func (ga *GoogleAnalytics) Update(object map[string]interface{}) error {
	return errors.New("GoogleAnalytics doesn't support updates")
}

//GetUsersRecognition returns users recognition configuration
func (ga *GoogleAnalytics) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (ga *GoogleAnalytics) GetUniqueIDField() *identifiers.UniqueID {
	return ga.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (ga *GoogleAnalytics) IsCachingDisabled() bool {
	return ga.cachingConfiguration != nil && ga.cachingConfiguration.Disabled
}

//Type returns Google Analytics type
func (ga *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}

func (ga *GoogleAnalytics) IsStaging() bool {
	return ga.staged
}

//Close closes GoogleAnalytics adapter, fallback logger and streaming worker
func (ga *GoogleAnalytics) Close() (multiErr error) {
	if err := ga.gaAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing GoogleAnalytics client: %v", ga.ID(), err))
	}

	if ga.streamingWorker != nil {
		if err := ga.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ga.ID(), err))
		}
	}

	if err := ga.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
