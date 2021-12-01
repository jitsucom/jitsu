package storages

import (
	"errors"
	"fmt"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

var disabledRecognitionConfiguration = &UserRecognitionConfiguration{enabled: false}

//BigQuery stores files to google BigQuery in two modes:
//batch: via google cloud storage in batch mode (1 file = 1 operation)
//stream: via events queue in stream mode (1 object = 1 operation)
type BigQuery struct {
	Abstract

	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	streamingWorker *StreamingWorker
}

func init() {
	RegisterStorage(StorageType{typeName: BigQueryType, createFunc: NewBigQuery})
}

//NewBigQuery returns BigQuery configured instance
func NewBigQuery(config *Config) (Storage, error) {
	gConfig := config.destination.GetConfig(config.destination.Google).(*adapters.GoogleConfig)
	if err := gConfig.Validate(); err != nil {
		return nil, err
	}
	if !config.streamMode {
		if err := gConfig.ValidateBatchMode(); err != nil {
			return nil, err
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
		var err error
		gcsAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, gConfig)
		if err != nil {
			return nil, err
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	bigQueryAdapter, err := adapters.NewBigQuery(config.ctx, gConfig, queryLogger, config.sqlTypes)
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

	tableHelper := NewTableHelper(bigQueryAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToBigQueryString, config.maxColumns, BigQueryType)

	bq := &BigQuery{
		gcsAdapter: gcsAdapter,
		bqAdapter:  bigQueryAdapter,
	}

	//Abstract
	bq.destinationID = config.destinationID
	bq.processor = config.processor
	bq.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	bq.eventsCache = config.eventsCache
	bq.tableHelpers = []*TableHelper{tableHelper}
	bq.sqlAdapters = []adapters.SQLAdapter{bigQueryAdapter}
	bq.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	bq.uniqueIDField = config.uniqueIDField
	bq.staged = config.destination.Staged
	bq.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	bq.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, bq, tableHelper)
	bq.streamingWorker.start()

	return bq, nil
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (bq *BigQuery) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	_, tableHelper := bq.getAdapters()
	flatData, failedEvents, skippedEvents, err := bq.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		bq.eventsCache.Error(bq.IsCachingDisabled(), bq.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		bq.eventsCache.Skip(bq.IsCachingDisabled(), bq.ID(), skipEvent.EventID, skipEvent.Error)
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
		for _, object := range fdata.GetPayload() {
			if err != nil {
				bq.eventsCache.Error(bq.IsCachingDisabled(), bq.ID(), bq.uniqueIDField.Extract(object), err.Error())
			} else {
				bq.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  bq.IsCachingDisabled(),
					DestinationID:  bq.ID(),
					EventID:        bq.uniqueIDField.Extract(object),
					ProcessedEvent: object,
					Table:          table,
				})
			}
		}
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
		b := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
		if err := bq.gcsAdapter.UploadBytes(fdata.FileName, b); err != nil {
			return err
		}

		if err := bq.bqAdapter.Copy(fdata.FileName, dbTable.Name); err != nil {
			return fmt.Errorf("Error copying file [%s] from gcp to bigquery: %v", fdata.FileName, err)
		}

		if err := bq.gcsAdapter.DeleteObject(fdata.FileName); err != nil {
			logging.SystemErrorf("[%s] file %s wasn't deleted from gcs: %v", bq.ID(), fdata.FileName, err)
		}

		return nil
	}

	//stream mode
	return bq.bqAdapter.BulkInsert(table, fdata.GetPayload())
}

//Update isn't supported
func (bq *BigQuery) Update(object map[string]interface{}) error {
	return errors.New("BigQuery doesn't support updates")
}

// SyncStore is used in storing chunk of pulled data to BigQuery with processing
func (bq *BigQuery) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	if len(objects) == 0 {
		return nil
	}

	_, tableHelper := bq.getAdapters()

	flatDataPerTable, err := processData(bq, overriddenDataSchema, objects, timeIntervalValue)
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

		start := time.Now()

		if err := bq.storeTable(flatData, table); err != nil {
			return err
		}

		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", bq.ID(), len(flatData.GetPayload()), time.Now().Sub(start).Seconds())
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
	if bq.gcsAdapter != nil {
		if err := bq.gcsAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing google cloud storage client: %v", bq.ID(), err))
		}
	}

	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing BigQuery client: %v", bq.ID(), err))
	}

	if bq.streamingWorker != nil {
		if err := bq.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", bq.ID(), err))
		}
	}

	if err := bq.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
