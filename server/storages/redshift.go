package storages

import (
	"fmt"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//AwsRedshift stores files to aws RedShift in two modes:
//batch: via aws s3 in batch mode (1 file = 1 statement)
//stream: via events queue in stream mode (1 object = 1 statement)
type AwsRedshift struct {
	Abstract

	s3Adapter                     *adapters.S3
	redshiftAdapter               *adapters.AwsRedshift
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: RedshiftType, createFunc: NewAwsRedshift})
}

//NewAwsRedshift returns AwsRedshift and start goroutine for aws redshift batch storage or for stream consumer depend on destination mode
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

	tableHelper := NewTableHelper(redshiftAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToRedshift, config.maxColumns, RedshiftType)

	ar := &AwsRedshift{
		s3Adapter:                     s3Adapter,
		redshiftAdapter:               redshiftAdapter,
		usersRecognitionConfiguration: config.usersRecognition,
	}

	//Abstract
	ar.destinationID = config.destinationID
	ar.processor = config.processor
	ar.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	ar.eventsCache = config.eventsCache
	ar.tableHelpers = []*TableHelper{tableHelper}
	ar.sqlAdapters = []adapters.SQLAdapter{redshiftAdapter}
	ar.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	ar.uniqueIDField = config.uniqueIDField
	ar.staged = config.destination.Staged
	ar.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	ar.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ar, tableHelper)
	ar.streamingWorker.start()

	return ar, nil
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (ar *AwsRedshift) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	_, tableHelper := ar.getAdapters()
	flatData, failedEvents, skippedEvents, err := ar.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		ar.eventsCache.Error(ar.IsCachingDisabled(), ar.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		ar.eventsCache.Skip(ar.IsCachingDisabled(), ar.ID(), skipEvent.EventID, skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := ar.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				ar.eventsCache.Error(ar.IsCachingDisabled(), ar.ID(), ar.uniqueIDField.Extract(object), err.Error())
			} else {
				ar.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  ar.IsCachingDisabled(),
					DestinationID:  ar.ID(),
					EventID:        ar.uniqueIDField.Extract(object),
					ProcessedEvent: object,
					Table:          table,
				})
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, err
	}

	return tableResults, nil, skippedEvents, nil
}

//check table schema
//and store data into one table via s3
func (ar *AwsRedshift) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := ar.getAdapters()
	dbTable, err := tableHelper.EnsureTableWithoutCaching(ar.ID(), table)
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

// SyncStore is used in storing chunk of pulled data to AwsRedshift with processing
func (ar *AwsRedshift) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return syncStoreImpl(ar, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

func (ar *AwsRedshift) Clean(tableName string) error {
	return cleanImpl(ar, tableName)
}

//Update updates record in Redshift
func (ar *AwsRedshift) Update(object map[string]interface{}) error {
	_, tableHelper := ar.getAdapters()
	batchHeader, processedObject, err := ar.processor.ProcessEvent(object)
	if err != nil {
		return err
	}

	table := tableHelper.MapTableSchema(batchHeader)

	dbSchema, err := tableHelper.EnsureTableWithCaching(ar.ID(), table)
	if err != nil {
		return err
	}

	start := time.Now()
	if err = ar.redshiftAdapter.Update(dbSchema, processedObject, ar.uniqueIDField.GetFlatFieldName(), ar.uniqueIDField.Extract(object)); err != nil {
		return err
	}
	logging.Debugf("[%s] Updated 1 row in [%.2f] seconds", ar.ID(), time.Now().Sub(start).Seconds())

	return nil
}

//GetUsersRecognition returns users recognition configuration
func (ar *AwsRedshift) GetUsersRecognition() *UserRecognitionConfiguration {
	return ar.usersRecognitionConfiguration
}

//Type returns Redshift type
func (ar *AwsRedshift) Type() string {
	return RedshiftType
}

//Close closes AwsRedshift adapter, fallback logger and streaming worker
func (ar *AwsRedshift) Close() (multiErr error) {
	if err := ar.redshiftAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing redshift datasource: %v", ar.ID(), err))
	}

	if ar.streamingWorker != nil {
		if err := ar.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ar.ID(), err))
		}
	}

	if err := ar.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
