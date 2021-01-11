package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
)

//Store files to aws s3 in batch mode
type S3 struct {
	name           string
	s3Adapter      *adapters.S3
	processor      *schema.Processor
	fallbackLogger *logging.AsyncLogger
	eventsCache    *caching.EventsCache
	stage          bool
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
		stage:          config.destination.Staged,
	}

	return s3, nil
}

func (s3 *S3) Consume(event events.Event, tokenId string) {
	logging.Errorf("[%s] S3 storage doesn't support streaming mode", s3.Name())
}

func (s3 *S3) DryRun(payload events.Event) ([]DryRunResponse, error) {
	return nil, errors.New("s3 does not support dry run functionality")
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (s3 *S3) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error) {
	return s3.StoreWithParseFunc(fileName, payload, alreadyUploadedTables, parsers.ParseJson)
}

//Store file from byte payload to s3 with processing
//return result per table, failed events count and err if occurred
func (s3 *S3) StoreWithParseFunc(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error) {
	flatData, failedEvents, err := s3.processor.ProcessFilePayload(fileName, payload, alreadyUploadedTables, parseFunc)
	if err != nil {
		return nil, linesCount(payload), err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents {
		s3.eventsCache.Error(s3.Name(), failedEvent.EventId, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		b := fdata.GetPayloadBytes(schema.JsonMarshallerInstance)
		err := s3.s3Adapter.UploadBytes(fileName, b)

		tableResults[fdata.BatchHeader.TableName] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen()}
		if err != nil {
			logging.Errorf("[%s] Error storing file %s: %v", s3.Name(), fileName, err)
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s3.eventsCache.Error(s3.Name(), events.ExtractEventId(object), err.Error())
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		s3.Fallback(failedEvents...)
	}

	return tableResults, len(failedEvents), nil
}

//Fallback log event with error to fallback logger
func (s3 *S3) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		s3.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (s3 *S3) SyncStore(collectionTable string, objects []map[string]interface{}, timeIntervalValue string) (int, error) {
	return 0, errors.New("S3 doesn't support sync store")
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
	return s3.stage
}

func (s3 *S3) Close() error {
	if err := s3.fallbackLogger.Close(); err != nil {
		return fmt.Errorf("[%s] Error closing fallback logger: %v", s3.Name(), err)
	}
	return nil
}
