package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/typing"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	sf "github.com/snowflakedb/gosnowflake"
)

//Snowflake stores files to Snowflake in two modes:
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
	staged           bool
}

func init() {
	RegisterStorage(SnowflakeType, NewSnowflake)
}

//NewSnowflake return Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(config *Config) (Storage, error) {
	snowflakeConfig := config.destination.Snowflake
	if err := snowflakeConfig.Validate(); err != nil {
		return nil, err
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, snowflakeConfig.Schema)
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

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	snowflakeAdapter, err := CreateSnowflakeAdapter(config.ctx, config.destination.S3, *snowflakeConfig, queryLogger, config.sqlTypes)
	if err != nil {
		if stageAdapter != nil {
			stageAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(snowflakeAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToSnowflake, config.streamMode, config.maxColumns)

	snowflake := &Snowflake{
		name:             config.destinationID,
		stageAdapter:     stageAdapter,
		snowflakeAdapter: snowflakeAdapter,
		tableHelper:      tableHelper,
		processor:        config.processor,
		fallbackLogger:   config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:      config.eventsCache,
		staged:           config.destination.Staged,
	}

	if config.streamMode {
		snowflake.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, snowflake, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
		snowflake.streamingWorker.start()
	}

	return snowflake, nil
}

//CreateSnowflakeAdapter creates snowflake adapter with schema
//if schema doesn't exist - snowflake returns error. In this case connect without schema and create it
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
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

				snowflakeAdapter, err = adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
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

func (s *Snowflake) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, s.processor, s.tableHelper)
}

//Insert event in Snowflake (1 retry if err)
func (s *Snowflake) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := s.tableHelper.EnsureTable(s.ID(), table)
	if err != nil {
		return err
	}

	err = s.snowflakeAdapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := s.tableHelper.RefreshTableSchema(s.ID(), table)
		if err != nil {
			return err
		}

		dbTable, err = s.tableHelper.EnsureTable(s.ID(), table)
		if err != nil {
			return err
		}

		return s.snowflakeAdapter.Insert(dbTable, event)
	}

	return nil
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (s *Snowflake) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	flatData, failedEvents, err := s.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		s.eventsCache.Error(s.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := s.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := s.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s.eventsCache.Error(s.ID(), events.ExtractEventID(object), err.Error())
			} else {
				s.eventsCache.Succeed(s.ID(), events.ExtractEventID(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, nil
	}

	return tableResults, nil, nil
}

//check table schema
//and store data into one table via stage (google cloud storage or s3)
func (s *Snowflake) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbTable, err := s.tableHelper.EnsureTable(s.ID(), table)
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
		logging.SystemErrorf("[%s] file %s wasn't deleted from stage: %v", s.ID(), fdata.FileName, err)
	}

	return nil
}

func (s *Snowflake) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Fallback log event with error to fallback logger
func (s *Snowflake) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		s.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (s *Snowflake) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("Snowflake doesn't support sync store")
}

func (s *Snowflake) Update(object map[string]interface{}) error {
	return errors.New("Snowflake doesn't support updates")
}

func (s *Snowflake) ID() string {
	return s.name
}

func (s *Snowflake) Type() string {
	return SnowflakeType
}

func (s *Snowflake) IsStaging() bool {
	return s.staged
}

func (s *Snowflake) Close() (multiErr error) {
	if err := s.snowflakeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake datasource: %v", s.ID(), err))
	}

	if s.stageAdapter != nil {
		if err := s.stageAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.ID(), err))
		}
	}

	if s.streamingWorker != nil {
		if err := s.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", s.ID(), err))
		}
	}

	if err := s.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", s.ID(), err))
	}

	return
}
