package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
)

var disabledRecognitionConfiguration = &UserRecognitionConfiguration{enabled: false}

//BigQuery stores files to google BigQuery in two modes:
//batch: via google cloud storage in batch mode (1 file = 1 operation)
//stream: via events queue in stream mode (1 object = 1 operation)
type BigQuery struct {
	Abstract

	gcsAdapter *adapters.GoogleCloudStorage
	bqAdapter  *adapters.BigQuery
}

func init() {
	RegisterStorage(StorageType{typeName: BigQueryType, createFunc: NewBigQuery, isSQL: true})
}

//NewBigQuery returns BigQuery configured instance
func NewBigQuery(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	gConfig := &adapters.GoogleConfig{}
	if err = config.destination.GetDestConfig(config.destination.Google, gConfig); err != nil {
		return
	}
	if !config.streamMode {
		if err = gConfig.ValidateBatchMode(); err != nil {
			return
		}
	}
	if gConfig.Project == "" {
		return nil, errors.New("BigQuery project(bq_project) is required parameter")
	}

	//enrich with default parameters
	if gConfig.Dataset == "" {
		gConfig.Dataset = "default"
		logging.Warnf("[%s] dataset wasn't provided. Will be used default one: %s", config.destinationID, gConfig.Dataset)
	}

	var gcsAdapter *adapters.GoogleCloudStorage
	if !config.streamMode {
		gcsAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, gConfig)
		if err != nil {
			return
		}
	}
	bq := &BigQuery{
		gcsAdapter: gcsAdapter,
	}
	err = bq.Init(config)
	if err != nil {
		return
	}
	storage = bq

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	bigQueryAdapter, err := adapters.NewBigQuery(config.ctx, gConfig, queryLogger, bq.sqlTypes)
	if err != nil {
		return
	}
	bq.bqAdapter = bigQueryAdapter

	//create dataset if doesn't exist
	err = bigQueryAdapter.CreateDataset(gConfig.Dataset)
	if err != nil {
		return
	}

	tableHelper := NewTableHelper("", bigQueryAdapter, config.coordinationService, config.pkFields, adapters.SchemaToBigQueryString, config.maxColumns, BigQueryType)

	//Abstract
	bq.tableHelpers = []*TableHelper{tableHelper}
	bq.sqlAdapters = []adapters.SQLAdapter{bigQueryAdapter}

	//streaming worker (queue reading)
	bq.streamingWorker = newStreamingWorker(config.eventQueue, bq, tableHelper)
	return
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (bq *BigQuery) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	_, tableHelper := bq.getAdapters()
	flatData, failedEvents, skippedEvents, err := bq.processor.ProcessEvents(fileName, objects, alreadyUploadedTables, needCopyEvent)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		bq.eventsCache.Error(bq.IsCachingDisabled(), bq.ID(), string(failedEvent.Event), failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		bq.eventsCache.Skip(bq.IsCachingDisabled(), bq.ID(), string(skipEvent.Event), skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := bq.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		writeEventsToCache(bq, bq.eventsCache, table, fdata, err)
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, nil
	}

	return tableResults, nil, skippedEvents, nil
}

//storeTable checks table schema
//stores data into one table via google cloud storage (if batch BQ) or uses streaming if stream mode
func (bq *BigQuery) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := bq.getAdapters()
	dbTable, err := tableHelper.EnsureTableWithoutCaching(bq.ID(), table)
	if err != nil {
		return err
	}

	//batch mode
	if bq.gcsAdapter != nil {
		fileName := fdata.FileName
		//in case of empty filename just generate it
		if fileName == "" {
			fileName = dbTable.Name + "_" + uuid.NewLettersNumbers()
		}
		b := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
		if err := bq.gcsAdapter.UploadBytes(fileName, b); err != nil {
			return err
		}

		if err := bq.bqAdapter.Copy(fileName, dbTable.Name); err != nil {
			return fmt.Errorf("Error copying file [%s] from gcp to bigquery: %v", fileName, err)
		}

		if err := bq.gcsAdapter.DeleteObject(fileName); err != nil {
			logging.SystemErrorf("[%s] file %s wasn't deleted from gcs: %v", bq.ID(), fileName, err)
		}

		return nil
	}

	//stream mode
	return bq.bqAdapter.Insert(adapters.NewBatchInsertContext(table, fdata.GetPayload(), nil))
}

//Update isn't supported
func (bq *BigQuery) Update(object map[string]interface{}) error {
	return errors.New("BigQuery doesn't support updates")
}

// SyncStore is used in storing chunk of pulled data to BigQuery with processing
func (bq *BigQuery) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool, needCopyEvent bool) error {
	if len(objects) == 0 {
		return nil
	}

	_, tableHelper := bq.getAdapters()

	flatDataPerTable, err := processData(bq, overriddenDataSchema, objects, timeIntervalValue, needCopyEvent)
	if err != nil {
		return err
	}

	deleteConditions := adapters.DeleteByTimeChunkCondition(timeIntervalValue)

	for _, flatData := range flatDataPerTable {
		table := tableHelper.MapTableSchema(flatData.BatchHeader)

		if !deleteConditions.IsEmpty() {
			if err = bq.bqAdapter.DeleteWithConditions(table.Name, deleteConditions); err != nil {
				return fmt.Errorf("Error deleting from BigQuery: %v", err)
			}
		}

		start := timestamp.Now()

		if err := bq.storeTable(flatData, table); err != nil {
			return err
		}

		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", bq.ID(), len(flatData.GetPayload()), timestamp.Now().Sub(start).Seconds())
	}

	return nil
}

func (bq *BigQuery) Clean(tableName string) error {
	return cleanImpl(bq, tableName)
}

//GetUsersRecognition returns disabled users recognition configuration
func (bq *BigQuery) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Type returns BigQuery type
func (bq *BigQuery) Type() string {
	return BigQueryType
}

//Close closes BigQuery adapter, fallback logger and streaming worker
func (bq *BigQuery) Close() (multiErr error) {
	if bq.streamingWorker != nil {
		if err := bq.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", bq.ID(), err))
		}
	}
	if bq.gcsAdapter != nil {
		if err := bq.gcsAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing google cloud storage client: %v", bq.ID(), err))
		}
	}

	if bq.bqAdapter != nil {
		if err := bq.bqAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing BigQuery client: %v", bq.ID(), err))
		}
	}

	if err := bq.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
