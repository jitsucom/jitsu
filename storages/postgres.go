package storages

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
)

//Store files to Postgres in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type Postgres struct {
	name                          string
	adapter                       *adapters.Postgres
	tableHelper                   *TableHelper
	processor                     *schema.Processor
	streamingWorker               *StreamingWorker
	fallbackLogger                *logging.AsyncLogger
	eventsCache                   *caching.EventsCache
	staged                        bool
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func NewPostgres(config *Config) (Storage, error) {
	pgConfig := config.destination.DataSource
	if err := pgConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if pgConfig.Port <= 0 {
		pgConfig.Port = 5432
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.name, pgConfig.Port)
	}
	if pgConfig.Schema == "" {
		pgConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.name, pgConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := pgConfig.Parameters["connect_timeout"]; !ok {
		pgConfig.Parameters["connect_timeout"] = "600"
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.name)
	adapter, err := adapters.NewPostgres(config.ctx, pgConfig, queryLogger, config.sqlTypeCasts)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(pgConfig.Schema)
	if err != nil {
		adapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToPostgres)

	p := &Postgres{
		name:                          config.name,
		adapter:                       adapter,
		tableHelper:                   tableHelper,
		processor:                     config.processor,
		fallbackLogger:                config.loggerFactory.CreateFailedLogger(config.name),
		eventsCache:                   config.eventsCache,
		usersRecognitionConfiguration: config.usersRecognition,
		staged:                        config.destination.Staged,
	}

	if config.streamMode {
		p.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, p, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.name), tableHelper)
		p.streamingWorker.start()
	}

	return p, nil
}

func (p *Postgres) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, p.processor, p.tableHelper)
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (p *Postgres) Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error) {
	return p.StoreWithParseFunc(fileName, payload, alreadyUploadedTables, parsers.ParseJson)
}

//StoreWithParseFunc file payload to Postgres with processing
//return result per table, failed events count and err if occurred
func (p *Postgres) StoreWithParseFunc(fileName string, payload []byte, alreadyUploadedTables map[string]bool,
	parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error) {
	flatData, failedEvents, err := p.processor.ProcessFilePayload(fileName, payload, alreadyUploadedTables, parseFunc)
	if err != nil {
		return nil, linesCount(payload), err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents {
		p.eventsCache.Error(p.Name(), failedEvent.EventId, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := p.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := p.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				p.eventsCache.Error(p.Name(), events.ExtractEventId(object), err.Error())
			} else {
				p.eventsCache.Succeed(p.Name(), events.ExtractEventId(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		p.Fallback(failedEvents...)
	}

	return tableResults, len(failedEvents), nil
}

//check table schema
//and store data into one table
func (p *Postgres) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbSchema, err := p.tableHelper.EnsureTable(p.Name(), table)
	if err != nil {
		return err
	}

	if err := p.adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}

	return nil
}

//Fallback log event with error to fallback logger
func (p *Postgres) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		p.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//SyncStore is used in two cases:
//1. store chunk payload to Postgres with processing
//2. store recognized users events
//return rows count and err if can't store
//or rows count and nil if stored
func (p *Postgres) SyncStore(overriddenCollectionTable string, objects []map[string]interface{}, timeIntervalValue string) (rowsCount int, err error) {
	flatData, err := p.processor.ProcessObjects(objects)
	if err != nil {
		return len(objects), err
	}

	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}
	deleteConditions := adapters.DeleteByTimeChunkCondition(timeIntervalValue)
	for _, fdata := range flatData {
		table := p.tableHelper.MapTableSchema(fdata.BatchHeader)

		//override table name
		if overriddenCollectionTable != "" {
			table.Name = overriddenCollectionTable
		}

		dbSchema, err := p.tableHelper.EnsureTable(p.Name(), table)
		if err != nil {
			return 0, err
		}
		if err = p.adapter.BulkUpdate(dbSchema, fdata.GetPayload(), deleteConditions); err != nil {
			return rowsCount, err
		}
	}

	return rowsCount, nil
}

//Insert event in Postgres (1 retry if error)
func (p *Postgres) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := p.tableHelper.EnsureTable(p.Name(), table)
	if err != nil {
		return err
	}

	err = p.adapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := p.tableHelper.RefreshTableSchema(p.Name(), table)
		if err != nil {
			return err
		}

		dbTable, err = p.tableHelper.EnsureTable(p.Name(), table)
		if err != nil {
			return err
		}

		return p.adapter.Insert(dbTable, event)
	}

	return nil
}

func (p *Postgres) GetUsersRecognition() *UserRecognitionConfiguration {
	return p.usersRecognitionConfiguration
}

//Close adapters.Postgres
func (p *Postgres) Close() (multiErr error) {
	if err := p.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", p.Name(), err))
	}

	if p.streamingWorker != nil {
		if err := p.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", p.Name(), err))
		}
	}

	if err := p.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", p.Name(), err))
	}

	return
}

func (p *Postgres) Name() string {
	return p.name
}

func (p *Postgres) Type() string {
	return PostgresType
}

func (p *Postgres) IsStaging() bool {
	return p.staged
}
