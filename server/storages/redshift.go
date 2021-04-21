package storages

import (
	"errors"
	"fmt"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//AwsRedshift stores files to aws RedShift in two modes:
//batch: via aws s3 in batch mode (1 file = 1 statement)
//stream: via events queue in stream mode (1 object = 1 statement)
type AwsRedshift struct {
	name                          string
	s3Adapter                     *adapters.S3
	redshiftAdapter               *adapters.AwsRedshift
	tableHelper                   *TableHelper
	processor                     *schema.Processor
	streamingWorker               *StreamingWorker
	fallbackLogger                *logging.AsyncLogger
	eventsCache                   *caching.EventsCache
	usersRecognitionConfiguration *UserRecognitionConfiguration
	staged                        bool
}

func init() {
	RegisterStorage(RedshiftType, NewAwsRedshift)
}

//NewAwsRedshift return AwsRedshift and start goroutine for aws redshift batch storage or for stream consumer depend on destination mode
func NewAwsRedshift(config *Config) (Storage, error) {
	redshiftConfig := config.destination.DataSource
	if err := redshiftConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if redshiftConfig.Port.String() == "" {
		redshiftConfig.Port = "5439"
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %s", config.destinationID, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, redshiftConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := redshiftConfig.Parameters["connect_timeout"]; !ok {
		redshiftConfig.Parameters["connect_timeout"] = "600"
	}

	var s3Adapter *adapters.S3
	if !config.streamMode {
		var err error
		s3Adapter, err = adapters.NewS3(config.destination.S3)
		if err != nil {
			return nil, err
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	redshiftAdapter, err := adapters.NewAwsRedshift(config.ctx, redshiftConfig, config.destination.S3, queryLogger, config.sqlTypes)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = redshiftAdapter.CreateDbSchema(redshiftConfig.Schema)
	if err != nil {
		redshiftAdapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(redshiftAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToRedshift, config.streamMode, config.maxColumns)

	ar := &AwsRedshift{
		name:                          config.destinationID,
		s3Adapter:                     s3Adapter,
		redshiftAdapter:               redshiftAdapter,
		tableHelper:                   tableHelper,
		processor:                     config.processor,
		fallbackLogger:                config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:                   config.eventsCache,
		usersRecognitionConfiguration: config.usersRecognition,
		staged:                        config.destination.Staged,
	}

	if config.streamMode {
		ar.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ar, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
		ar.streamingWorker.start()
	}

	return ar, nil
}

func (ar *AwsRedshift) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, ar.processor, ar.tableHelper)
}

//Insert event in Redshift
func (ar *AwsRedshift) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := ar.tableHelper.EnsureTable(ar.ID(), table)
	if err != nil {
		return err
	}

	err = ar.redshiftAdapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := ar.tableHelper.RefreshTableSchema(ar.ID(), table)
		if err != nil {
			return err
		}

		dbTable, err = ar.tableHelper.EnsureTable(ar.ID(), table)
		if err != nil {
			return err
		}

		return ar.redshiftAdapter.Insert(dbTable, event)
	}

	return nil
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (ar *AwsRedshift) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	flatData, failedEvents, err := ar.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		ar.eventsCache.Error(ar.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := ar.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := ar.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				ar.eventsCache.Error(ar.ID(), events.ExtractEventID(object), err.Error())
			} else {
				ar.eventsCache.Succeed(ar.ID(), events.ExtractEventID(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, err
	}

	return tableResults, nil, nil
}

//check table schema
//and store data into one table via s3
func (ar *AwsRedshift) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbTable, err := ar.tableHelper.EnsureTable(ar.ID(), table)
	if err != nil {
		return err
	}

	b := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
	if err := ar.s3Adapter.UploadBytes(fdata.FileName, b); err != nil {
		return err
	}

	if err := ar.redshiftAdapter.Copy(fdata.FileName, dbTable.Name); err != nil {
		return fmt.Errorf("Error copying file [%s] from s3 to redshift: %v", fdata.FileName, err)
	}

	if err := ar.s3Adapter.DeleteObject(fdata.FileName); err != nil {
		logging.SystemErrorf("[%s] file %s wasn't deleted from s3: %v", ar.ID(), fdata.FileName, err)
	}

	return nil
}

//Fallback log event with error to fallback logger
func (ar *AwsRedshift) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		ar.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//SyncStore isn't supported
func (ar *AwsRedshift) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	return errors.New("RedShift doesn't support sync store")
}

//Update updates record in Redshift
func (ar *AwsRedshift) Update(object map[string]interface{}) error {
	batchHeader, processedObject, err := ar.processor.ProcessEvent(object)
	if err != nil {
		return err
	}

	table := ar.tableHelper.MapTableSchema(batchHeader)

	dbSchema, err := ar.tableHelper.EnsureTable(ar.ID(), table)
	if err != nil {
		return err
	}

	start := time.Now()
	if err = ar.redshiftAdapter.Update(dbSchema, processedObject, events.EventnCtxEventID, events.ExtractEventID(object)); err != nil {
		return err
	}
	logging.Debugf("[%s] Updated 1 row in [%.2f] seconds", ar.ID(), time.Now().Sub(start).Seconds())

	return nil
}

//GetUsersRecognition returns users recognition settings
func (ar *AwsRedshift) GetUsersRecognition() *UserRecognitionConfiguration {
	return ar.usersRecognitionConfiguration
}

//Name returns destination ID
func (ar *AwsRedshift) ID() string {
	return ar.name
}

func (ar *AwsRedshift) Type() string {
	return RedshiftType
}

func (ar *AwsRedshift) IsStaging() bool {
	return ar.staged
}

func (ar *AwsRedshift) Close() (multiErr error) {
	if err := ar.redshiftAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing redshift datasource: %v", ar.ID(), err))
	}

	if ar.streamingWorker != nil {
		if err := ar.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ar.ID(), err))
		}
	}

	if err := ar.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", ar.ID(), err))
	}

	return
}
