package storages

import (
	"errors"
	"fmt"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//S3 stores files to aws s3 in batch mode
type S3 struct {
	Abstract

	s3Adapter            *adapters.S3
	processor            *schema.Processor
	fallbackLogger       *logging.AsyncLogger
	eventsCache          *caching.EventsCache
	uniqueIDField        *identifiers.UniqueID
	cachingConfiguration *CachingConfiguration
	staged               bool
}

func init() {
	RegisterStorage(S3Type, NewS3)
}

func NewS3(config *Config) (Storage, error) {
	if config.streamMode {
		if config.eventQueue != nil {
			config.eventQueue.Close()
		}
		return nil, fmt.Errorf("S3 destination doesn't support %s mode", StreamMode)
	}
	s3Config := config.destination.S3
	if err := s3Config.Validate(); err != nil {
		return nil, err
	}

	s3Adapter, err := adapters.NewS3(s3Config)
	if err != nil {
		return nil, err
	}

	s3 := &S3{
		s3Adapter:            s3Adapter,
		processor:            config.processor,
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	//Abstract (SQLAdapters and tableHelpers and archive logger are omitted)
	s3.destinationID = config.destinationID
	s3.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	s3.eventsCache = config.eventsCache
	s3.stageAdapter = s3Adapter

	return s3, nil
}

func (s3 *S3) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return nil, errors.New("s3 does not support dry run functionality")
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (s3 *S3) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	flatData, failedEvents, err := s3.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		s3.eventsCache.Error(s3.IsCachingDisabled(), s3.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		b := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
		err := s3.s3Adapter.UploadBytes(fileName, b)

		tableResults[fdata.BatchHeader.TableName] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			logging.Errorf("[%s] Error storing file %s: %v", s3.ID(), fileName, err)
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s3.eventsCache.Error(s3.IsCachingDisabled(), s3.ID(), s3.uniqueIDField.Extract(object), err.Error())
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, nil
	}

	return tableResults, nil, nil
}

//SyncStore isn't supported
func (s3 *S3) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return errors.New("S3 doesn't support sync store")
}

//Update isn't suported
func (s3 *S3) Update(object map[string]interface{}) error {
	return errors.New("S3 doesn't support updates")
}

//GetUsersRecognition returns disabled users recognition configuration
func (s3 *S3) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (s3 *S3) GetUniqueIDField() *identifiers.UniqueID {
	return s3.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (s3 *S3) IsCachingDisabled() bool {
	return s3.cachingConfiguration != nil && s3.cachingConfiguration.Disabled
}

//Type returns S3 type
func (s3 *S3) Type() string {
	return S3Type
}

func (s3 *S3) IsStaging() bool {
	return s3.staged
}

//Close closes fallback logger
func (s3 *S3) Close() error {
	return s3.close()
}
