package storages

import (
	"fmt"
	"io"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/pkg/errors"
)

type FileAdapter interface {
	io.Closer
	UploadBytes(fileName string, fileBytes []byte) error
	Compression() adapters.FileCompression
	Format() adapters.FileEncodingFormat
}

type FileStorage struct {
	Abstract
	storageType string
	adapter     FileAdapter
}

func (fs *FileStorage) DryRun(events.Event) ([][]adapters.TableField, error) {
	return nil, errors.Errorf("[%s] does not support dry run functionality", fs.storageType)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (fs *FileStorage) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	processedFiles, _, failedEvents, skippedEvents, err := fs.processor.ProcessEvents(fileName, objects, alreadyUploadedTables, needCopyEvent)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		fs.eventsCache.Error(fs.IsCachingDisabled(), fs.ID(), string(failedEvent.Event), failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		fs.eventsCache.Skip(fs.IsCachingDisabled(), fs.ID(), string(skipEvent.Event), skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range processedFiles {
		err := fs.uploadFile(fdata)

		tableResults[fdata.BatchHeader.TableName] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			logging.Errorf("[%s] Error storing file %s: %v", fs.ID(), fileName, err)
			storeFailedEvents = false
		}

		//events cache
		writeEventsToCache(fs, fs.eventsCache, nil, fdata, err)
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, nil
	}

	return tableResults, nil, skippedEvents, nil
}

func (fs *FileStorage) uploadFile(f *schema.ProcessedFile) error {
	b, err := fs.marshall(f)
	if err != nil {
		return fmt.Errorf("marshalling error: %v", err)
	}
	fileName := fs.fileName(f)
	return fs.adapter.UploadBytes(fileName, b)
}

func (fs *FileStorage) marshall(fdata *schema.ProcessedFile) ([]byte, error) {
	encodingFormat := fs.adapter.Format()
	switch encodingFormat {
	case adapters.FileFormatCSV:
		return fdata.GetPayloadBytes(schema.CSVMarshallerInstance)
	case adapters.FileFormatFlatJSON, adapters.FileFormatJSON:
		return fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
	case adapters.FileFormatParquet:
		pm := schema.NewParquetMarshaller(fs.adapter.Compression() == adapters.FileCompressionGZIP)
		return fdata.GetPayloadUsingStronglyTypedMarshaller(pm)
	default:
		return nil, fmt.Errorf("unsupported %s encoding format %v", fs.storageType, encodingFormat)
	}
}

func (fs *FileStorage) fileName(fdata *schema.ProcessedFile) string {
	start, end := findStartEndTimestamp(fdata.GetPayload())
	var extension string
	if fs.adapter.Format() == adapters.FileFormatParquet {
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
func (fs *FileStorage) SyncStore(*schema.BatchHeader, []map[string]interface{}, string, bool, bool) error {
	return errors.Errorf("[%s] doesn't support sync store", fs.storageType)
}

//Update isn't supported
func (fs *FileStorage) Update(map[string]interface{}) error {
	return errors.Errorf("[%s] doesn't support updates", fs.storageType)
}

//GetUsersRecognition returns disabled users recognition configuration
func (fs *FileStorage) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Type returns file storage type
func (fs *FileStorage) Type() string {
	return fs.storageType
}

//Close closes fallback logger
func (fs *FileStorage) Close() (multiErr error) {
	if err := fs.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing %s adapter: %v", fs.ID(), fs.storageType, err))
	}
	if err := fs.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}

func requireBatchMode(config *Config) error {
	if config.streamMode {
		if config.eventQueue != nil {
			_ = config.eventQueue.Close()
		}

		return errors.Errorf("%s destination doesn't support %s mode", GCSType, StreamMode)
	}

	return nil
}

type (
	CreateStorage = func(config *Config) (Storage, error)
	ExtractConfig = func(config *config.DestinationConfig) map[string]interface{}
)

func RegisterFileStorage(storageType string, createStorage CreateStorage, extractConfig ExtractConfig) {
	RegisterStorage(StorageType{
		typeName:   storageType,
		createFunc: createStorage,
		isSQLFunc: func(config *config.DestinationConfig) bool {
			mp := utils.NvlMap(config.Config, extractConfig(config))
			return mp["format"] != string(adapters.FileFormatJSON)
		},
	})
}
