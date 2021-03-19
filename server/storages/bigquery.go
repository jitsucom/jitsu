package storages

import (
	"errors"
	"fmt"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/schema"
)

var disabledRecognitionConfiguration = &UserRecognitionConfiguration{Enabled: false}

//Store files to google BigQuery in two modes:
//batch: via google cloud storage in batch mode (1 file = 1 operation)
//stream: via events queue in stream mode (1 object = 1 operation)
type BigQuery struct {
	name            string
	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	tableHelper     *TableHelper
	processor       *schema.Processor
	streamingWorker *StreamingWorker
	fallbackLogger  *logging.AsyncLogger
	eventsCache     *caching.EventsCache
	staged          bool
}

func NewBigQuery(config *Config) (Storage, error) {
	gConfig := config.destination.Google
	if err := gConfig.Validate(config.streamMode); err != nil {
		return nil, err
	}

	if gConfig.Project == "" {
		return nil, errors.New("BigQuery project(bq_project) is required parameter")
	}

	//enrich with default parameters
	if gConfig.Dataset == "" {
		gConfig.Dataset = "default"
		logging.Warnf("[%s] dataset wasn't provided. Will be used default one: %s", config.name, gConfig.Dataset)
	}

	var gcsAdapter *adapters.GoogleCloudStorage
	if !config.streamMode {
		var err error
		gcsAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, gConfig)
		if err != nil {
			return nil, err
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)
	bigQueryAdapter, err := adapters.NewBigQuery(config.ctx, gConfig, queryLogger, config.sqlTypeCasts)
	if err != nil {
		return nil, err
	}

	//create dataset if doesn't exist
	err = bigQueryAdapter.CreateDataset(gConfig.Dataset)
	if err != nil {
		bigQueryAdapter.Close()
		if gcsAdapter != nil {
			gcsAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(bigQueryAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToBigQueryString, config.streamMode)

	bq := &BigQuery{
		name:           config.name,
		gcsAdapter:     gcsAdapter,
		bqAdapter:      bigQueryAdapter,
		tableHelper:    tableHelper,
		processor:      config.processor,
		fallbackLogger: config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:    config.eventsCache,
		staged:         config.destination.Staged,
	}

	if config.streamMode {
		bq.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, bq, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelper)
		bq.streamingWorker.start()
	}

	return bq, nil
}

func (bq *BigQuery) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, bq.processor, bq.tableHelper)
}

//Insert event in BigQuery
func (bq *BigQuery) Insert(dataSchema *adapters.Table, event events.Event) (err error) {
	dbTable, err := bq.tableHelper.EnsureTable(bq.Name(), dataSchema)
	if err != nil {
		return err
	}

	err = bq.bqAdapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := bq.tableHelper.RefreshTableSchema(bq.Name(), dataSchema)
		if err != nil {
			return err
		}

		dbTable, err = bq.tableHelper.EnsureTable(bq.Name(), dataSchema)
		if err != nil {
			return err
		}

		return bq.bqAdapter.Insert(dbTable, event)
	}

	return nil
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (bq *BigQuery) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error) {
	return bq.StoreWithParseFunc(fileName, payload, alreadyUploadedTables, parsers.ParseJson)
}

//StoreWithParseFunc store file from byte payload to BigQuery with processing
//return result per table, failed events count and err if occurred
func (bq *BigQuery) StoreWithParseFunc(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error) {
	flatData, failedEvents, err := bq.processor.ProcessFilePayload(fileName, payload, alreadyUploadedTables, parseFunc)
	if err != nil {
		return nil, linesCount(payload), err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents {
		bq.eventsCache.Error(bq.Name(), failedEvent.EventId, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := bq.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := bq.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				bq.eventsCache.Error(bq.Name(), events.ExtractEventId(object), err.Error())
			} else {
				bq.eventsCache.Succeed(bq.Name(), events.ExtractEventId(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		bq.Fallback(failedEvents...)
	}

	return tableResults, len(failedEvents), nil
}

//check table schema
//and store data into one table via google cloud storage
func (bq *BigQuery) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbTable, err := bq.tableHelper.EnsureTable(bq.Name(), table)
	if err != nil {
		return err
	}

	b := fdata.GetPayloadBytes(schema.JsonMarshallerInstance)
	if err := bq.gcsAdapter.UploadBytes(fdata.FileName, b); err != nil {
		return err
	}

	if err := bq.bqAdapter.Copy(fdata.FileName, dbTable.Name); err != nil {
		return fmt.Errorf("Error copying file [%s] from gcp to bigquery: %v", fdata.FileName, err)
	}

	if err := bq.gcsAdapter.DeleteObject(fdata.FileName); err != nil {
		logging.SystemErrorf("[%s] file %s wasn't deleted from gcs: %v", bq.Name(), fdata.FileName, err)
	}

	return nil
}

func (bq *BigQuery) Update(object map[string]interface{}) error {
	return errors.New("BigQuery doesn't support updates")
}

func (bq *BigQuery) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) (int, error) {
	return 0, errors.New("BigQuery doesn't support sync store")
}

func (bq *BigQuery) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Fallback log event with error to fallback logger
func (bq *BigQuery) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		bq.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (bq *BigQuery) Name() string {
	return bq.name
}

func (bq *BigQuery) Type() string {
	return BigQueryType
}

func (bq *BigQuery) IsStaging() bool {
	return bq.staged
}

func (bq *BigQuery) Close() (multiErr error) {
	if bq.gcsAdapter != nil {
		if err := bq.gcsAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing google cloud storage client: %v", bq.Name(), err))
		}
	}

	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing BigQuery client: %v", bq.Name(), err))
	}

	if bq.streamingWorker != nil {
		if err := bq.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", bq.Name(), err))
		}
	}

	if err := bq.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", bq.Name(), err))
	}

	return
}
