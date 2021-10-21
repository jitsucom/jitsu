package storages

import (
	"fmt"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
)

//ClickHouse stores files to ClickHouse in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type ClickHouse struct {
	Abstract

	adapters                      []*adapters.ClickHouse
	chTableHelpers                []*TableHelper
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: ClickHouseType, createFunc: NewClickHouse})
}

//NewClickHouse returns configured ClickHouse instance
func NewClickHouse(config *Config) (Storage, error) {
	chConfig := config.destination.ClickHouse
	if err := chConfig.Validate(); err != nil {
		return nil, err
	}

	tableStatementFactory, err := adapters.NewTableStatementFactory(chConfig)
	if err != nil {
		return nil, err
	}

	nullableFields := map[string]bool{}
	if chConfig.Engine != nil {
		for _, fieldName := range chConfig.Engine.NullableFields {
			nullableFields[fieldName] = true
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)

	//creating tableHelpers and Adapters
	//1 helper+adapter per ClickHouse node
	var chAdapters []*adapters.ClickHouse
	var sqlAdapters []adapters.SQLAdapter
	var chTableHelpers []*TableHelper
	for _, dsn := range chConfig.Dsns {
		adapter, err := adapters.NewClickHouse(config.ctx, dsn, chConfig.Database, chConfig.Cluster, chConfig.TLS,
			tableStatementFactory, nullableFields, queryLogger, config.sqlTypes)
		if err != nil {
			//close all previous created adapters
			for _, toClose := range chAdapters {
				toClose.Close()
			}
			return nil, err
		}

		chAdapters = append(chAdapters, adapter)
		sqlAdapters = append(sqlAdapters, adapter)
		chTableHelpers = append(chTableHelpers, NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToClickhouse, config.maxColumns, ClickHouseType))
	}

	ch := &ClickHouse{
		adapters:                      chAdapters,
		chTableHelpers:                chTableHelpers,
		usersRecognitionConfiguration: config.usersRecognition,
	}

	//Abstract
	ch.destinationID = config.destinationID
	ch.processor = config.processor
	ch.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	ch.eventsCache = config.eventsCache
	ch.tableHelpers = chTableHelpers
	ch.sqlAdapters = sqlAdapters
	ch.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	ch.uniqueIDField = config.uniqueIDField
	ch.staged = config.destination.Staged
	ch.cachingConfiguration = config.destination.CachingConfiguration

	err = chAdapters[0].CreateDB(chConfig.Database)
	if err != nil {
		//close all previous created adapters
		for _, toClose := range chAdapters {
			toClose.Close()
		}
		ch.fallbackLogger.Close()
		return nil, err
	}

	//streaming worker (queue reading)
	ch.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ch, chTableHelpers...)
	ch.streamingWorker.start()

	return ch, nil
}

//Type returns ClickHouse type
func (ch *ClickHouse) Type() string {
	return ClickHouseType
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (ch *ClickHouse) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	flatData, failedEvents, skippedEvents, err := ch.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		ch.eventsCache.Error(ch.IsCachingDisabled(), ch.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		ch.eventsCache.Skip(ch.IsCachingDisabled(), ch.ID(), skipEvent.EventID, skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		adapter, tableHelper := ch.getAdapters()
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := ch.storeTable(adapter, tableHelper, fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				ch.eventsCache.Error(ch.IsCachingDisabled(), ch.ID(), ch.uniqueIDField.Extract(object), err.Error())
			} else {
				ch.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  ch.IsCachingDisabled(),
					DestinationID:  ch.ID(),
					EventID:        ch.uniqueIDField.Extract(object),
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

//check table schema
//and store data into one table
func (ch *ClickHouse) storeTable(adapter adapters.SQLAdapter, tableHelper *TableHelper, fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(ch.ID(), table)
	if err != nil {
		return err
	}

	if err := adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}

	return nil
}

//SyncStore is used in storing chunk of pulled data to ClickHouse with processing
func (ch *ClickHouse) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return syncStoreImpl(ch, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

func (ch *ClickHouse) Clean(tableName string) error {
	return cleanImpl(ch, tableName)
}

//Update uses SyncStore under the hood
func (ch *ClickHouse) Update(object map[string]interface{}) error {
	return ch.SyncStore(nil, []map[string]interface{}{object}, "", true)
}

//GetUsersRecognition returns users recognition configuration
func (ch *ClickHouse) GetUsersRecognition() *UserRecognitionConfiguration {
	return ch.usersRecognitionConfiguration
}

//Close closes ClickHouse adapters, fallback logger and streaming worker
func (ch *ClickHouse) Close() (multiErr error) {
	for i, adapter := range ch.adapters {
		if err := adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing clickhouse datasource[%d]: %v", ch.ID(), i, err))
		}
	}

	if ch.streamingWorker != nil {
		if err := ch.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ch.ID(), err))
		}
	}

	if err := ch.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
