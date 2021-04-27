package storages

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//Postgres stores files to Postgres in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type Postgres struct {
	destinationID                 string
	adapter                       *adapters.Postgres
	tableHelper                   *TableHelper
	processor                     *schema.Processor
	streamingWorker               *StreamingWorker
	fallbackLogger                *logging.AsyncLogger
	eventsCache                   *caching.EventsCache
	usersRecognitionConfiguration *UserRecognitionConfiguration
	uniqueIDField                 *identifiers.UniqueID
	staged                        bool
}

func init() {
	RegisterStorage(PostgresType, NewPostgres)
}

//NewPostgres returns configured Postgres Destination
func NewPostgres(config *Config) (Storage, error) {
	pgConfig := config.destination.DataSource
	if err := pgConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if pgConfig.Port.String() == "" {
		pgConfig.Port = json.Number("5432")
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %s", config.destinationID, pgConfig.Port.String())
	}
	if pgConfig.Schema == "" {
		pgConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, pgConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := pgConfig.Parameters["connect_timeout"]; !ok {
		pgConfig.Parameters["connect_timeout"] = "600"
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	adapter, err := adapters.NewPostgres(config.ctx, pgConfig, queryLogger, config.sqlTypes)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(pgConfig.Schema)
	if err != nil {
		adapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToPostgres, config.streamMode, config.maxColumns)

	p := &Postgres{
		destinationID:                 config.destinationID,
		adapter:                       adapter,
		tableHelper:                   tableHelper,
		processor:                     config.processor,
		fallbackLogger:                config.loggerFactory.CreateFailedLogger(config.destinationID),
		eventsCache:                   config.eventsCache,
		usersRecognitionConfiguration: config.usersRecognition,
		uniqueIDField:                 config.uniqueIDField,
		staged:                        config.destination.Staged,
	}

	if config.streamMode {
		p.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, p, config.eventsCache, config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID), tableHelper)
		p.streamingWorker.start()
	}

	return p, nil
}

func (p *Postgres) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, p.processor, p.tableHelper)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (p *Postgres) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	flatData, failedEvents, err := p.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		p.eventsCache.Error(p.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := p.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := p.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				p.eventsCache.Error(p.ID(), p.uniqueIDField.Extract(object), err.Error())
			} else {
				p.eventsCache.Succeed(p.ID(), p.uniqueIDField.Extract(object), object, table)
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
func (p *Postgres) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	dbSchema, err := p.tableHelper.EnsureTable(p.ID(), table)
	if err != nil {
		return err
	}

	start := time.Now()
	if err := p.adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}
	logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", p.ID(), len(fdata.GetPayload()), time.Now().Sub(start).Seconds())

	return nil
}

//Fallback logs event with error to fallback logger
func (p *Postgres) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		p.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (p *Postgres) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string) error {
	flatData, err := p.processor.ProcessPulledEvents(timeIntervalValue, objects)
	if err != nil {
		return err
	}

	deleteConditions := adapters.DeleteByTimeChunkCondition(timeIntervalValue)

	//table schema overridden
	if overriddenDataSchema != nil && len(overriddenDataSchema.Fields) > 0 {
		var data []map[string]interface{}
		//ignore table multiplexing from mapping step
		for _, fdata := range flatData {
			data = append(data, fdata.GetPayload()...)
			//enrich overridden schema with new fields (some system fields or e.g. after lookup step)
			overriddenDataSchema.Fields.Add(fdata.BatchHeader.Fields)
		}

		table := p.tableHelper.MapTableSchema(overriddenDataSchema)

		dbSchema, err := p.tableHelper.EnsureTable(p.ID(), table)
		if err != nil {
			return err
		}
		if err = p.adapter.BulkUpdate(dbSchema, data, deleteConditions); err != nil {
			return err
		}

		return nil
	}

	//plain flow
	for _, fdata := range flatData {
		table := p.tableHelper.MapTableSchema(fdata.BatchHeader)

		//overridden table destinationID
		if overriddenDataSchema != nil && overriddenDataSchema.TableName != "" {
			table.Name = overriddenDataSchema.TableName
		}

		dbSchema, err := p.tableHelper.EnsureTable(p.ID(), table)
		if err != nil {
			return err
		}
		start := time.Now()
		if err = p.adapter.BulkUpdate(dbSchema, fdata.GetPayload(), deleteConditions); err != nil {
			return err
		}
		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", p.ID(), len(fdata.GetPayload()), time.Now().Sub(start).Seconds())
	}

	return nil
}

//Update uses SyncStore under the hood
func (p *Postgres) Update(object map[string]interface{}) error {
	return p.SyncStore(nil, []map[string]interface{}{object}, "")
}

//Insert event in Postgres (1 retry if error)
func (p *Postgres) Insert(table *adapters.Table, event events.Event) (err error) {
	dbTable, err := p.tableHelper.EnsureTable(p.ID(), table)
	if err != nil {
		return err
	}

	err = p.adapter.Insert(dbTable, event)

	//renew current db schema and retry
	if err != nil {
		dbTable, err := p.tableHelper.RefreshTableSchema(p.ID(), table)
		if err != nil {
			return err
		}

		dbTable, err = p.tableHelper.EnsureTable(p.ID(), table)
		if err != nil {
			return err
		}

		return p.adapter.Insert(dbTable, event)
	}

	return nil
}

//GetUsersRecognition returns users recognition configuration
func (p *Postgres) GetUsersRecognition() *UserRecognitionConfiguration {
	return p.usersRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (p *Postgres) GetUniqueIDField() *identifiers.UniqueID {
	return p.uniqueIDField
}

//Close closes Postgres adapter, fallback logger and streaming worker
func (p *Postgres) Close() (multiErr error) {
	if err := p.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", p.ID(), err))
	}

	if p.streamingWorker != nil {
		if err := p.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", p.ID(), err))
		}
	}

	if err := p.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", p.ID(), err))
	}

	return
}

//ID returns destination ID
func (p *Postgres) ID() string {
	return p.destinationID
}

//Type returns Facebook type
func (p *Postgres) Type() string {
	return PostgresType
}

func (p *Postgres) IsStaging() bool {
	return p.staged
}
