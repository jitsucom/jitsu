package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
)

//Postgres stores files to Postgres in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type Postgres struct {
	Abstract

	adapter                       *adapters.Postgres
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: PostgresType, createFunc: NewPostgres, isSQL: true})
}

//NewPostgres returns configured Postgres Destination
func NewPostgres(config *Config) (Storage, error) {
	pgConfig := &adapters.DataSourceConfig{}
	if err := config.destination.GetDestConfig(config.destination.DataSource, pgConfig); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if pgConfig.Port == 0 {
		pgConfig.Port = 5432
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.destinationID, pgConfig.Port)
	}
	if pgConfig.Schema == "" {
		pgConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, pgConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := pgConfig.Parameters["connect_timeout"]; !ok {
		pgConfig.Parameters["connect_timeout"] = "600"
	}

	dir := adapters.SSLDir(appconfig.Instance.ConfigPath, config.destinationID)
	if err := adapters.ProcessSSL(dir, pgConfig); err != nil {
		return nil, err
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ctx := context.WithValue(config.ctx, adapters.CtxDestinationId, config.destinationID)
	adapter, err := adapters.NewPostgres(ctx, pgConfig, queryLogger, config.sqlTypes)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(pgConfig.Schema)
	if err != nil {
		adapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(pgConfig.Schema, adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToPostgres, config.maxColumns, PostgresType)

	p := &Postgres{
		adapter:                       adapter,
		usersRecognitionConfiguration: config.usersRecognition,
	}

	//Abstract
	p.destinationID = config.destinationID
	p.processor = config.processor
	p.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	p.eventsCache = config.eventsCache
	p.tableHelpers = []*TableHelper{tableHelper}
	p.sqlAdapters = []adapters.SQLAdapter{adapter}
	p.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	p.uniqueIDField = config.uniqueIDField
	p.staged = config.destination.Staged
	p.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	p.streamingWorker, err = newStreamingWorker(config.eventQueue, config.processor, p, tableHelper)
	if err != nil {
		return nil, err
	}
	p.streamingWorker.start()

	return p, nil
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (p *Postgres) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	_, tableHelper := p.getAdapters()
	flatData, failedEvents, skippedEvents, err := p.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		p.eventsCache.Error(p.IsCachingDisabled(), p.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		p.eventsCache.Skip(p.IsCachingDisabled(), p.ID(), skipEvent.EventID, skipEvent.Error)
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
				p.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  p.IsCachingDisabled(),
					DestinationID:  p.ID(),
					EventID:        p.uniqueIDField.Extract(object),
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
func (p *Postgres) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := p.getAdapters()
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(p.ID(), table)
	if err != nil {
		return err
	}

	start := timestamp.Now()
	if err := p.adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}
	logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", p.ID(), len(fdata.GetPayload()), timestamp.Now().Sub(start).Seconds())

	return nil
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (p *Postgres) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return syncStoreImpl(p, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

func (p *Postgres) Clean(tableName string) error {
	return cleanImpl(p, tableName)
}

//Update updates record in Postgres
func (p *Postgres) Update(objects []map[string]interface{}) error {
	_, tableHelper := p.getAdapters()
	for _, object := range objects {
		envelops, err := p.processor.ProcessEvent(object)
		if err != nil {
			return err
		}

		for _, envelop := range envelops {
			batchHeader := envelop.Header
			processedObject := envelop.Event
			table := tableHelper.MapTableSchema(batchHeader)

			dbSchema, err := tableHelper.EnsureTableWithCaching(p.ID(), table)
			if err != nil {
				return err
			}

			start := timestamp.Now()
			if err = p.adapter.Update(dbSchema, processedObject, p.uniqueIDField.GetFlatFieldName(), p.uniqueIDField.Extract(object)); err != nil {
				return err
			}
			logging.Debugf("[%s] Updated 1 row in [%.2f] seconds", p.ID(), timestamp.Now().Sub(start).Seconds())
		}
	}

	return nil
}

//GetUsersRecognition returns users recognition configuration
func (p *Postgres) GetUsersRecognition() *UserRecognitionConfiguration {
	return p.usersRecognitionConfiguration
}

//Type returns Facebook type
func (p *Postgres) Type() string {
	return PostgresType
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
