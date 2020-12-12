package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
	sf "github.com/snowflakedb/gosnowflake"
)

//Store files to Snowflake in two modes:
//batch: via aws s3 (or gcp) in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type Snowflake struct {
	name             string
	stageAdapter     adapters.Stage
	snowflakeAdapter *adapters.Snowflake
	tableHelper      *TableHelper
	processor        *schema.Processor
	streamingWorker  *StreamingWorker
	fallbackLogger   *logging.AsyncLogger
	eventsCache      *caching.EventsCache
}

//NewSnowflake return Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(config *Config) (events.Storage, error) {
	snowflakeConfig := config.destination.Snowflake
	if err := snowflakeConfig.Validate(); err != nil {
		return nil, err
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, snowflakeConfig.Schema)
	}

	//default client_session_keep_alive
	if _, ok := snowflakeConfig.Parameters["client_session_keep_alive"]; !ok {
		t := "true"
		snowflakeConfig.Parameters["client_session_keep_alive"] = &t
	}

	if config.destination.Google != nil {
		if err := config.destination.Google.Validate(config.streamMode); err != nil {
			return nil, err
		}
		//stage is required when gcp integration
		if snowflakeConfig.Stage == "" {
			return nil, errors.New("Snowflake stage is required parameter in GCP integration")
		}
	}

	var stageAdapter adapters.Stage
	if !config.streamMode {
		var err error
		if config.destination.S3 != nil {
			stageAdapter, err = adapters.NewS3(config.destination.S3)
			if err != nil {
				return nil, err
			}
		} else {
			stageAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, config.destination.Google)
			if err != nil {
				return nil, err
			}
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)
	snowflakeAdapter, err := CreateSnowflakeAdapter(config.ctx, config.destination.S3, *snowflakeConfig, queryLogger, config.sqlTypeCasts)
	if err != nil {
		if stageAdapter != nil {
			stageAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(snowflakeAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToSnowflake)

	snowflake := &Snowflake{
		name:             config.name,
		stageAdapter:     stageAdapter,
		snowflakeAdapter: snowflakeAdapter,
		tableHelper:      tableHelper,
		processor:        config.processor,
		fallbackLogger:   config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:      config.eventsCache,
	}

	if config.streamMode {
		snowflake.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, snowflake, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelper)
		snowflake.streamingWorker.start()
	}

	return snowflake, nil
}

//create snowflake adapter with schema
//if schema doesn't exist - snowflake returns error. In this case connect without schema and create it
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig,
	queryLogger *logging.QueryLogger, sqlTypeCasts map[string]string) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypeCasts)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypeCasts)
				if err != nil {
					return nil, err
				}
				config.Schema = snowflakeSchema
				//create schema and reconnect
				err = snowflakeAdapter.CreateDbSchema(config.Schema)
				if err != nil {
					return nil, err
				}
				snowflakeAdapter.Close()

				snowflakeAdapter, err = adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypeCasts)
				if err != nil {
					return nil, err
				}
				return snowflakeAdapter, nil
			}
		}
		return nil, err
	}
	return snowflakeAdapter, nil
}

//Insert event in Snowflake (1 retry if err)
func (s *Snowflake) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := s.tableHelper.EnsureTable(s.Name(), table)
	if err != nil {
		return err
	}

	err = s.snowflakeAdapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := s.tableHelper.RefreshTableSchema(s.Name(), table)
		if err != nil {
			return err
		}

		return s.snowflakeAdapter.Insert(dbTable, event)
	}

	return nil
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (s *Snowflake) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*events.StoreResult, int, error) {
	return s.StoreWithParseFunc(fileName, payload, alreadyUploadedTables, parsers.ParseJson)
}

//Store file from byte payload to stage with processing
//return result per table, failed events count and err if occurred
func (s *Snowflake) StoreWithParseFunc(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*events.StoreResult, int, error) {
	flatData, failedEvents, err := s.processor.ProcessFilePayload(fileName, payload, alreadyUploadedTables, parseFunc)
	if err != nil {
		return nil, linesCount(payload), err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents {
		s.eventsCache.Error(s.Name(), failedEvent.EventId, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*events.StoreResult{}
	for _, fdata := range flatData {
		table := s.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := s.storeTable(fdata, table)
		tableResults[table.Name] = &events.StoreResult{Err: err, RowsCount: fdata.GetPayloadLen()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s.eventsCache.Error(s.Name(), events.ExtractEventId(object), err.Error())
			} else {
				s.eventsCache.Succeed(s.Name(), events.ExtractEventId(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		s.Fallback(failedEvents...)
	}

	return tableResults, len(failedEvents), nil
}

//check table schema
//and store data into one table via stage (google cloud storage or s3)
func (s *Snowflake) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbTable, err := s.tableHelper.EnsureTable(s.Name(), table)
	if err != nil {
		return err
	}

	b, header := fdata.GetPayloadBytesWithHeader(schema.CsvMarshallerInstance)
	if err := s.stageAdapter.UploadBytes(fdata.FileName, b); err != nil {
		return err
	}

	if err := s.snowflakeAdapter.Copy(fdata.FileName, dbTable.Name, header); err != nil {
		return fmt.Errorf("Error copying file [%s] from stage to snowflake: %v", fdata.FileName, err)
	}

	if err := s.stageAdapter.DeleteObject(fdata.FileName); err != nil {
		logging.SystemErrorf("[%s] file %s wasn't deleted from stage: %v", s.Name(), fdata.FileName, err)
	}

	return nil
}

//Fallback log event with error to fallback logger
func (s *Snowflake) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		s.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (s *Snowflake) SyncStore(objects []map[string]interface{}) (int, error) {
	return 0, errors.New("Snowflake doesn't support sync store")
}

func (s *Snowflake) Name() string {
	return s.name
}

func (s *Snowflake) Type() string {
	return SnowflakeType
}

func (s *Snowflake) Close() (multiErr error) {
	if err := s.snowflakeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake datasource: %v", s.Name(), err))
	}

	if s.stageAdapter != nil {
		if err := s.stageAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.Name(), err))
		}
	}

	if s.streamingWorker != nil {
		if err := s.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", s.Name(), err))
		}
	}

	if err := s.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", s.Name(), err))
	}

	return
}
