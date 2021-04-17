package storages

import (
	"fmt"
	"math/rand"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//ClickHouse stores files to ClickHouse in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type ClickHouse struct {
	name                          string
	adapters                      []*adapters.ClickHouse
	tableHelpers                  []*TableHelper
	processor                     *schema.Processor
	streamingWorker               *StreamingWorker
	fallbackLogger                *logging.AsyncLogger
	eventsCache                   *caching.EventsCache
	usersRecognitionConfiguration *UserRecognitionConfiguration
	staged                        bool
}

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

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)

	var chAdapters []*adapters.ClickHouse
	var tableHelpers []*TableHelper
	for _, dsn := range chConfig.Dsns {
		adapter, err := adapters.NewClickHouse(config.ctx, dsn, chConfig.Database, chConfig.Cluster, chConfig.TLS,
			tableStatementFactory, nullableFields, queryLogger, config.sqlTypeCasts)
		if err != nil {
			//close all previous created adapters
			for _, toClose := range chAdapters {
				toClose.Close()
			}
			return nil, err
		}

		chAdapters = append(chAdapters, adapter)
		tableHelpers = append(tableHelpers, NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToClickhouse, config.streamMode, config.maxColumns))
	}

	ch := &ClickHouse{
		name:                          config.name,
		adapters:                      chAdapters,
		tableHelpers:                  tableHelpers,
		processor:                     config.processor,
		eventsCache:                   config.eventsCache,
		fallbackLogger:                config.loggerFactory.CreateFailedLogger(config.name),
		usersRecognitionConfiguration: config.usersRecognition,
		staged:                        config.destination.Staged,
	}

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
		ch.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, ch, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelpers...)
		ch.streamingWorker.start()
	}

	return ch, nil
}

func (ch *ClickHouse) Name() string {
	return ch.name
}

func (ch *ClickHouse) Type() string {
	return ClickHouseType
}

func (ch *ClickHouse) DryRun(payload events.Event) ([]adapters.TableField, error) {
	_, tableHelper := ch.getAdapters()
	return dryRun(payload, ch.processor, tableHelper)
}

//Insert event in ClickHouse (1 retry if err)
func (ch *ClickHouse) Insert(dataSchema *adapters.Table, event events.Event) (err error) {
	adapter, tableHelper := ch.getAdapters()

	dbSchema, err := tableHelper.EnsureTable(ch.Name(), dataSchema)
	if err != nil {
		return err
	}

	err = adapter.Insert(dbSchema, event)

	//renew current db schema and retry
	if err != nil {
		dbSchema, err := tableHelper.RefreshTableSchema(ch.Name(), dataSchema)
		if err != nil {
			return err
		}

		dbSchema, err = tableHelper.EnsureTable(ch.Name(), dataSchema)
		if err != nil {
			return err
		}

		return adapter.Insert(dbSchema, event)
	}

	return nil
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
		ch.eventsCache.Error(ch.Name(), failedEvent.EventID, failedEvent.Error)
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
				ch.eventsCache.Error(ch.Name(), events.ExtractEventID(object), err.Error())
			} else {
				ch.eventsCache.Succeed(ch.Name(), events.ExtractEventID(object), object, table)
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
	dbSchema, err := tableHelper.EnsureTable(ch.Name(), table)
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

		dbSchema, err := tableHelper.EnsureTable(ch.Name(), table)
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

		//overridden table name
		if overriddenDataSchema != nil && overriddenDataSchema.TableName != "" {
			table.Name = overriddenDataSchema.TableName
		}

		dbSchema, err := tableHelper.EnsureTable(ch.Name(), table)
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

func (ch *ClickHouse) Update(object map[string]interface{}) error {
	return ch.SyncStore(nil, []map[string]interface{}{object}, "")
}

func (ch *ClickHouse) GetUsersRecognition() *UserRecognitionConfiguration {
	return ch.usersRecognitionConfiguration
}

//Fallback log event with error to fallback logger
func (ch *ClickHouse) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		ch.fallbackLogger.ConsumeAny(failedEvent)
	}
}

func (ch *ClickHouse) IsStaging() bool {
	return ch.staged
}

//Close adapters.ClickHouse
func (ch *ClickHouse) Close() (multiErr error) {
	for i, adapter := range ch.adapters {
		if err := adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing clickhouse datasource[%d]: %v", ch.Name(), i, err))
		}
	}

	if ch.streamingWorker != nil {
		if err := ch.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ch.Name(), err))
		}
	}

	if err := ch.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", ch.Name(), err))
	}

	return
}

//assume that adapters quantity == tableHelpers quantity
func (ch *ClickHouse) getAdapters() (*adapters.ClickHouse, *TableHelper) {
	num := rand.Intn(len(ch.adapters))
	return ch.adapters[num], ch.tableHelpers[num]
}
