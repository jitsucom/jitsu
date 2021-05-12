package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//Facebook stores events to Facebook Conversion API in stream mode
type Facebook struct {
	destinationID        string
	fbAdapter            *adapters.FacebookConversionAPI
	tableHelper          *TableHelper
	processor            *schema.Processor
	streamingWorker      *StreamingWorker
	fallbackLogger       *logging.AsyncLogger
	eventsCache          *caching.EventsCache
	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration
}

func init() {
	RegisterStorage(FacebookType, NewFacebook)
}

//NewFacebook returns configured Facebook instance
//start streaming worker goroutine
func NewFacebook(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Facebook destination doesn't support %s mode", BatchMode)
	}

	fbConfig := config.destination.Facebook
	if err := fbConfig.Validate(); err != nil {
		return nil, err
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	fbAdapter := adapters.NewFacebookConversion(fbConfig, requestDebugLogger)

	tableHelper := NewTableHelper(fbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, config.streamMode, 0)

	fb := &Facebook{
		destinationID:        config.destinationID,
		fbAdapter:            fbAdapter,
		tableHelper:          tableHelper,
		processor:            config.processor,
		fallbackLogger:       config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:          config.eventsCache,
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	fb.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, fb, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
	fb.streamingWorker.start()

	return fb, nil
}

func (fb *Facebook) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, fb.processor, fb.tableHelper)
}

//Insert sends event to Facebook Conversion API
func (fb *Facebook) Insert(table *adapters.Table, event events.Event) (err error) {
	return fb.fbAdapter.Send(event)
}

//Store isn't supported
func (fb *Facebook) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("Facebook Conversion doesn't support Store() func")
}

//SyncStore isn't supported
func (fb *Facebook) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("Facebook Conversion doesn't support SyncStore() func")
}

//Update isn't supported
func (fb *Facebook) Update(object map[string]interface{}) error {
	return errors.New("Facebook doesn't support updates")
}

//GetUsersRecognition returns users recognition configuration
func (fb *Facebook) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (fb *Facebook) GetUniqueIDField() *identifiers.UniqueID {
	return fb.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (fb *Facebook) IsCachingDisabled() bool {
	return fb.cachingConfiguration != nil && fb.cachingConfiguration.Disabled
}

//Fallback log event with error to fallback logger
func (fb *Facebook) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		fb.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//ID returns destination ID
func (fb *Facebook) ID() string {
	return fb.destinationID
}

//Type returns Facebook type
func (fb *Facebook) Type() string {
	return FacebookType
}

func (fb *Facebook) IsStaging() bool {
	return fb.staged
}

//Close closes Facebook adapter, fallback logger and streaming worker
func (fb *Facebook) Close() (multiErr error) {
	if err := fb.fbAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing Facebook client: %v", fb.ID(), err))
	}

	if fb.streamingWorker != nil {
		if err := fb.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", fb.ID(), err))
		}
	}

	if err := fb.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", fb.ID(), err))
	}

	return
}
