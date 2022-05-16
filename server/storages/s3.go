package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/utils"
	"time"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//S3 stores files to aws s3 in batch mode
type S3 struct {
	Abstract

	s3Adapter *adapters.S3
}

func init() {
	RegisterStorage(StorageType{
		typeName:   S3Type,
		createFunc: NewS3,
		//S3 can store SQL data it depends on "format".
		isSQLFunc: func(config *config.DestinationConfig) bool {
			mp := utils.NvlMap(config.Config, config.S3)
			return mp["format"] != string(adapters.S3FormatJSON)
		}})
}

func NewS3(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if config.streamMode {
		if config.eventQueue != nil {
			config.eventQueue.Close()
		}
		return nil, fmt.Errorf("S3 destination doesn't support %s mode", StreamMode)
	}
	s3Config := &adapters.S3Config{}
	if err = config.destination.GetDestConfig(config.destination.S3, s3Config); err != nil {
		return
	}
	s3 := &S3{}
	err = s3.Init(config, s3, "", "")
	if err != nil {
		return
	}
	storage = s3

	s3Adapter, err := adapters.NewS3(s3Config)
	if err != nil {
		return
	}

	s3.s3Adapter = s3Adapter
	return
}

func (s3 *S3) DryRun(events.Event) ([][]adapters.TableField, error) {
	return nil, errors.New("s3 does not support dry run functionality")
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (s3 *S3) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	processedFiles, _, failedEvents, skippedEvents, err := s3.processor.ProcessEvents(fileName, objects, alreadyUploadedTables, needCopyEvent)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		s3.eventsCache.Error(s3.IsCachingDisabled(), s3.ID(), string(failedEvent.Event), failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		s3.eventsCache.Skip(s3.IsCachingDisabled(), s3.ID(), string(skipEvent.Event), skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range processedFiles {
		err := s3.uploadFile(fdata)

		tableResults[fdata.BatchHeader.TableName] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			logging.Errorf("[%s] Error storing file %s: %v", s3.ID(), fileName, err)
			storeFailedEvents = false
		}

		//events cache
		writeEventsToCache(s3, s3.eventsCache, nil, fdata, err)
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, nil
	}

	return tableResults, nil, skippedEvents, nil
}

func (s3 *S3) uploadFile(f *schema.ProcessedFile) error {
	b, err := s3.marshall(f)
	if err != nil {
		return fmt.Errorf("marshalling error: %v", err)
	}
	fileName := s3.fileName(f)
	return s3.s3Adapter.UploadBytes(fileName, b)
}

func (s3 *S3) marshall(fdata *schema.ProcessedFile) ([]byte, error) {
	encodingFormat := s3.s3Adapter.Format()
	switch encodingFormat {
	case adapters.S3FormatCSV:
		return fdata.GetPayloadBytes(schema.CSVMarshallerInstance)
	case adapters.S3FormatFlatJSON, adapters.S3FormatJSON:
		return fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
	case adapters.S3FormatParquet:
		pm := schema.NewParquetMarshaller(s3.s3Adapter.Compression() == adapters.S3CompressionGZIP)
		return fdata.GetPayloadUsingStronglyTypedMarshaller(pm)
	default:
		return nil, fmt.Errorf("unsupported s3 encoding format %v", encodingFormat)
	}
}

func (s3 *S3) fileName(fdata *schema.ProcessedFile) string {
	start, end := findStartEndTimestamp(fdata.GetPayload())
	var extension string
	if s3.s3Adapter.Format() == adapters.S3FormatParquet {
		extension = "parquet"
	} else {
		extension = "log"
	}
	return fmt.Sprintf("%s-%s-%s-%s.%s", fdata.BatchHeader.TableName, start.Format("2006-01-02T15:04:05"), end.Format("15:04:05"), appconfig.Instance.ServerName, extension)
}

func findStartEndTimestamp(fdata []map[string]interface{}) (time.Time, time.Time) {
	var start, end time.Time
	for _, it := range fdata {
		if objectTSValue, ok := it[timestamp.Key]; ok {
			var datetime time.Time
			datetime, err := typing.ParseTimestamp(objectTSValue)
			if err != nil {
				logging.SystemErrorf("Error parsing %v value under %s key: %v", objectTSValue, timestamp.Key, err)
			}

			if start.IsZero() || datetime.Before(start) {
				start = datetime
			}
			if end.IsZero() || datetime.After(end) {
				end = datetime
			}
		}
	}
	if start.IsZero() || end.IsZero() {
		now := timestamp.Now()
		start = now
		end = now
	}

	return start, end
}

//SyncStore isn't supported
func (s3 *S3) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *adapters.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	return errors.New("S3 doesn't support sync store")
}

//Update isn't supported
func (s3 *S3) Update(map[string]interface{}) error {
	return errors.New("S3 doesn't support updates")
}

//GetUsersRecognition returns disabled users recognition configuration
func (s3 *S3) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Type returns S3 type
func (s3 *S3) Type() string {
	return S3Type
}

//Close closes fallback logger
func (s3 *S3) Close() (multiErr error) {
	if err := s3.s3Adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing s3 adapter: %v", s3.ID(), err))
	}
	if err := s3.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}
