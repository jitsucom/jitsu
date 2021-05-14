package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"math/rand"

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
	tableHelpers                  []*TableHelper
	processor                     *schema.Processor
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
	uniqueIDField                 *identifiers.UniqueID
	staged                        bool
	cachingConfiguration          *CachingConfiguration
}

func init() {
	RegisterStorage(ClickHouseType, NewClickHouse)
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
	var tableHelpers []*TableHelper
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
		tableHelpers = append(tableHelpers, NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToClickhouse, config.streamMode, config.maxColumns))
	}

	ch := &ClickHouse{
		adapters:                      chAdapters,
		tableHelpers:                  tableHelpers,
		processor:                     config.processor,
		usersRecognitionConfiguration: config.usersRecognition,
		uniqueIDField:                 config.uniqueIDField,
		staged:                        config.destination.Staged,
		cachingConfiguration:          config.destination.CachingConfiguration,
	}

	//Abstract
	ch.destinationID = config.destinationID
	ch.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	ch.eventsCache = config.eventsCache
	ch.tableHelpers = tableHelpers
	ch.sqlAdapters = sqlAdapters
	ch.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	adapter, _ := ch.getAdapters()
	err = adapter.CreateDB(chConfig.Database)
	if err != nil {
		//close all previous created adapters
		for _, toClose := range chAdapters {
			toClose.Close()
		}
		ch.fallbackLogger.Close()
		return nil, err
	}

	if config.streamMode {
		ch.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ch, tableHelpers...)
		ch.streamingWorker.start()
	}

	return ch, nil
}

//Type returns ClickHouse type
func (ch *ClickHouse) Type() string {
	return ClickHouseType
}

func (ch *ClickHouse) DryRun(payload events.Event) ([]adapters.TableField, error) {
	_, tableHelper := ch.getAdapters()
	return dryRun(payload, ch.processor, tableHelper)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (ch *ClickHouse) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	flatData, failedEvents, err := ch.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		ch.eventsCache.Error(ch.IsCachingDisabled(), ch.ID(), failedEvent.EventID, failedEvent.Error)
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
				ch.eventsCache.Succeed(ch.IsCachingDisabled(), ch.ID(), ch.uniqueIDField.Extract(object), object, table)
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
//and store data into one table
func (ch *ClickHouse) storeTable(adapter *adapters.ClickHouse, tableHelper *TableHelper, fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbSchema, err := tableHelper.EnsureTable(ch.ID(), table)
	if err != nil {
		return err
	}

	if err := adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}

	return nil
}

//SyncStore is used in storing chunk of pulled data to ClickHouse with processing
func (ch *ClickHouse) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	flatData, err := ch.processor.ProcessPulledEvents(timeIntervalValue, objects)
	if err != nil {
		return err
	}

	deleteConditions := adapters.DeleteByTimeChunkCondition(timeIntervalValue)

	//table schema overridden (is used by Singer sources)
	if overriddenDataSchema != nil && len(overriddenDataSchema.Fields) > 0 {
		var data []map[string]interface{}
		//ignore table multiplexing from mapping step
		for _, fdata := range flatData {
			data = append(data, fdata.GetPayload()...)
			//enrich overridden schema with new fields (some system fields or e.g. after lookup step)
			overriddenDataSchema.Fields.Add(fdata.BatchHeader.Fields)
		}

		adapter, tableHelper := ch.getAdapters()

		table := tableHelper.MapTableSchema(overriddenDataSchema)

		dbSchema, err := tableHelper.EnsureTable(ch.ID(), table)
		if err != nil {
			return err
		}
		if err = adapter.BulkUpdate(dbSchema, data, deleteConditions); err != nil {
			return err
		}

		return nil
	}

	//plain flow
	for _, fdata := range flatData {
		adapter, tableHelper := ch.getAdapters()
		table := tableHelper.MapTableSchema(fdata.BatchHeader)

		//overridden table destinationID
		if overriddenDataSchema != nil && overriddenDataSchema.TableName != "" {
			table.Name = overriddenDataSchema.TableName
		}

		dbSchema, err := tableHelper.EnsureTable(ch.ID(), table)
		if err != nil {
			return err
		}
		err = adapter.BulkUpdate(dbSchema, fdata.GetPayload(), deleteConditions)
		if err != nil {
			return err
		}
	}

	return nil
}

//Update uses SyncStore under the hood
func (ch *ClickHouse) Update(object map[string]interface{}) error {
	return ch.SyncStore(nil, []map[string]interface{}{object}, "")
}

//GetUsersRecognition returns users recognition configuration
func (ch *ClickHouse) GetUsersRecognition() *UserRecognitionConfiguration {
	return ch.usersRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (ch *ClickHouse) GetUniqueIDField() *identifiers.UniqueID {
	return ch.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (ch *ClickHouse) IsCachingDisabled() bool {
	return ch.cachingConfiguration != nil && ch.cachingConfiguration.Disabled
}

func (ch *ClickHouse) IsStaging() bool {
	return ch.staged
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

//assume that adapters quantity == tableHelpers quantity
func (ch *ClickHouse) getAdapters() (*adapters.ClickHouse, *TableHelper) {
	num := rand.Intn(len(ch.adapters))
	return ch.adapters[num], ch.tableHelpers[num]
}
