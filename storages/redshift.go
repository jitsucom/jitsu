package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
)

const tableFileKeyDelimiter = "-table-"
const rowsFileKeyDelimiter = "-rows-"

//Store files to aws RedShift in two modes:
//batch: via aws s3 in batch mode (1 file = 1 statement)
//stream: via events queue in stream mode (1 object = 1 statement)
type AwsRedshift struct {
	name            string
	s3Adapter       *adapters.S3
	redshiftAdapter *adapters.AwsRedshift
	tableHelper     *TableHelper
	schemaProcessor *schema.MappingStep
	streamingWorker *StreamingWorker
	fallbackLogger  *logging.AsyncLogger
	eventsCache     *caching.EventsCache
}

//NewAwsRedshift return AwsRedshift and start goroutine for aws redshift batch storage or for stream consumer depend on destination mode
func NewAwsRedshift(config *Config) (events.Storage, error) {
	redshiftConfig := config.destination.DataSource
	if err := redshiftConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if redshiftConfig.Port <= 0 {
		redshiftConfig.Port = 5439
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.name, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, redshiftConfig.Schema)
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

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)
	redshiftAdapter, err := adapters.NewAwsRedshift(config.ctx, redshiftConfig, config.destination.S3, queryLogger, config.sqlTypeCasts)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = redshiftAdapter.CreateDbSchema(redshiftConfig.Schema)
	if err != nil {
		redshiftAdapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(redshiftAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToRedshift)

	ar := &AwsRedshift{
		name:            config.name,
		s3Adapter:       s3Adapter,
		redshiftAdapter: redshiftAdapter,
		tableHelper:     tableHelper,
		schemaProcessor: config.processor,
		fallbackLogger:  config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:     config.eventsCache,
	}

	if config.streamMode {
		ar.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ar, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelper)
		ar.streamingWorker.start()
	}

	return ar, nil
}

//Insert event in Redshift
func (ar *AwsRedshift) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := ar.tableHelper.EnsureTable(ar.Name(), table)
	if err != nil {
		return err
	}

	err = ar.redshiftAdapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := ar.tableHelper.RefreshTableSchema(ar.Name(), table)
		if err != nil {
			return err
		}

		return ar.redshiftAdapter.Insert(dbTable, event)
	}

	return nil
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (ar *AwsRedshift) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*events.StoreResult, int, error) {
	return ar.StoreWithParseFunc(fileName, payload, alreadyUploadedTables, parsers.ParseJson)
}

//StoreWithParseFunc file payload to AwsRedshift with processing
//return result per table, failed events count and err if occurred
func (ar *AwsRedshift) StoreWithParseFunc(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*events.StoreResult, int, error) {
	flatData, failedEvents, err := ar.schemaProcessor.ProcessFilePayload(fileName, payload, alreadyUploadedTables, parseFunc)
	if err != nil {
		return nil, linesCount(payload), err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents {
		ar.eventsCache.Error(ar.Name(), failedEvent.EventId, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*events.StoreResult{}
	for _, fdata := range flatData {
		table := ar.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := ar.storeTable(fdata, table)
		tableResults[table.Name] = &events.StoreResult{Err: err, RowsCount: fdata.GetPayloadLen()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				ar.eventsCache.Error(ar.Name(), events.ExtractEventId(object), err.Error())
			} else {
				ar.eventsCache.Succeed(ar.Name(), events.ExtractEventId(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		ar.Fallback(failedEvents...)
	}

	return tableResults, len(failedEvents), nil
}

//check table schema
//and store data into one table via s3
func (ar *AwsRedshift) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbTable, err := ar.tableHelper.EnsureTable(ar.Name(), table)
	if err != nil {
		return err
	}

	b := fdata.GetPayloadBytes(schema.JsonMarshallerInstance)
	if err := ar.s3Adapter.UploadBytes(fdata.FileName, b); err != nil {
		return err
	}

	if err := ar.redshiftAdapter.Copy(fdata.FileName, dbTable.Name); err != nil {
		return fmt.Errorf("Error copying file [%s] from s3 to redshift: %v", fdata.FileName, err)
	}

	if err := ar.s3Adapter.DeleteObject(fdata.FileName); err != nil {
		logging.SystemErrorf("[%s] file %s wasn't deleted from s3: %v", ar.Name(), fdata.FileName, err)
	}

	return nil
}

//Fallback log event with error to fallback logger
func (ar *AwsRedshift) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		ar.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (ar *AwsRedshift) SyncStore(objects []map[string]interface{}) (int, error) {
	return 0, errors.New("RedShift doesn't support sync store")
}

func (ar *AwsRedshift) Name() string {
	return ar.name
}

func (ar *AwsRedshift) Type() string {
	return RedshiftType
}

func (ar *AwsRedshift) Close() (multiErr error) {
	if err := ar.redshiftAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing redshift datasource: %v", ar.Name(), err))
	}

	if ar.streamingWorker != nil {
		if err := ar.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ar.Name(), err))
		}
	}

	if err := ar.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", ar.Name(), err))
	}

	return
}
