package storages

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/jitsucom/jitsu/server/identifiers"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//Postgres stores files to Postgres in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type Postgres struct {
	Abstract

	adapter                       *adapters.Postgres
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
	uniqueIDField                 *identifiers.UniqueID
	staged                        bool
	cachingConfiguration          *CachingConfiguration
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

	tableHelper := NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToPostgres, config.maxColumns)

	p := &Postgres{
		adapter:                       adapter,
		usersRecognitionConfiguration: config.usersRecognition,
		uniqueIDField:                 config.uniqueIDField,
		staged:                        config.destination.Staged,
		cachingConfiguration:          config.destination.CachingConfiguration,
	}

	//Abstract
	p.destinationID = config.destinationID
	p.processor = config.processor
	p.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	p.eventsCache = config.eventsCache
	p.tableHelpers = []*TableHelper{tableHelper}
	p.sqlAdapters = []adapters.SQLAdapter{adapter}
	p.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	//streaming worker (queue reading)
	p.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, p, tableHelper)
	p.streamingWorker.start()

	return p, nil
}

func (p *Postgres) DryRun(payload events.Event) ([]adapters.TableField, error) {
	_, tableHelper := p.getAdapters()
	return dryRun(payload, p.processor, tableHelper)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (p *Postgres) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	_, tableHelper := p.getAdapters()
	flatData, failedEvents, err := p.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		p.eventsCache.Error(p.IsCachingDisabled(), p.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := p.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				p.eventsCache.Error(p.IsCachingDisabled(), p.ID(), p.uniqueIDField.Extract(object), err.Error())
			} else {
				p.eventsCache.Succeed(p.IsCachingDisabled(), p.ID(), p.uniqueIDField.Extract(object), object, table)
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
	_, tableHelper := p.getAdapters()
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(p.ID(), table)
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

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (p *Postgres) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return syncStoreImpl(p, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

//Update uses SyncStore under the hood
func (p *Postgres) Update(object map[string]interface{}) error {
	return p.SyncStore(nil, []map[string]interface{}{object}, "", true)
}

//GetUsersRecognition returns users recognition configuration
func (p *Postgres) GetUsersRecognition() *UserRecognitionConfiguration {
	return p.usersRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (p *Postgres) GetUniqueIDField() *identifiers.UniqueID {
	return p.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (p *Postgres) IsCachingDisabled() bool {
	return p.cachingConfiguration != nil && p.cachingConfiguration.Disabled
}

//Type returns Facebook type
func (p *Postgres) Type() string {
	return PostgresType
}

func (p *Postgres) IsStaging() bool {
	return p.staged
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

	if err := p.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
