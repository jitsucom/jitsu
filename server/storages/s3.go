package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//S3 stores files to aws s3 in batch mode
type S3 struct {
	name           string
	s3Adapter      *adapters.S3
	processor      *schema.Processor
	fallbackLogger *logging.AsyncLogger
	eventsCache    *caching.EventsCache
	staged         bool
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
		name:           config.name,
		s3Adapter:      s3Adapter,
		processor:      config.processor,
		fallbackLogger: config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:    config.eventsCache,
		staged:         config.destination.Staged,
	}

	return s3, nil
}

func (s3 *S3) Consume(event events.Event, tokenID string) {
	logging.Errorf("[%s] S3 storage doesn't support streaming mode", s3.Name())
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
		s3.eventsCache.Error(s3.Name(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		b := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
		err := s3.s3Adapter.UploadBytes(fileName, b)

		tableResults[fdata.BatchHeader.TableName] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			logging.Errorf("[%s] Error storing file %s: %v", s3.Name(), fileName, err)
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s3.eventsCache.Error(s3.Name(), events.ExtractEventID(object), err.Error())
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, nil
	}

	return tableResults, nil, nil
}

//Fallback log event with error to fallback logger
func (s3 *S3) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		s3.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (s3 *S3) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("S3 doesn't support sync store")
}

func (s3 *S3) Update(object map[string]interface{}) error {
	return errors.New("S3 doesn't support updates")
}

func (s3 *S3) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

func (s3 *S3) Name() string {
	return s3.name
}

func (s3 *S3) Type() string {
	return S3Type
}

func (s3 *S3) IsStaging() bool {
	return s3.staged
}

func (s3 *S3) Close() error {
	if err := s3.fallbackLogger.Close(); err != nil {
		return fmt.Errorf("[%s] Error closing fallback logger: %v", s3.Name(), err)
	}
	return nil
}
