package storages

import (
	"context"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
)

//MySQL stores files to MySQL in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type MySQL struct {
	Abstract

	adapter                       *adapters.MySQL
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: MySQLType, createFunc: NewMySQL, isSQL: true})
}

//NewMySQL returns configured MySQL Destination
func NewMySQL(config *Config) (Storage, error) {
	mConfig := &adapters.DataSourceConfig{}
	if err := config.destination.GetDestConfig(config.destination.DataSource, mConfig); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if mConfig.Port == 0 {
		mConfig.Port = 3306
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.destinationID, mConfig.Port)
	}
	//schema and database are synonyms in MySQL
	//default connect timeout seconds
	if _, ok := mConfig.Parameters["timeout"]; !ok {
		mConfig.Parameters["timeout"] = "600s"
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ctx := context.WithValue(config.ctx, adapters.CtxDestinationId, config.destinationID)
	adapter, err := CreateMySQLAdapter(ctx, *mConfig, queryLogger, config.sqlTypes)
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(mConfig.Schema, adapter, config.coordinationService, config.pkFields, adapters.SchemaToMySQL, config.maxColumns, MySQLType)

	m := &MySQL{
		adapter:                       adapter,
		usersRecognitionConfiguration: config.usersRecognition,
	}

	//Abstract
	m.destinationID = config.destinationID
	m.processor = config.processor
	m.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	m.eventsCache = config.eventsCache
	m.tableHelpers = []*TableHelper{tableHelper}
	m.sqlAdapters = []adapters.SQLAdapter{adapter}
	m.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	m.uniqueIDField = config.uniqueIDField
	m.staged = config.destination.Staged
	m.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	m.streamingWorker, err = newStreamingWorker(config.eventQueue, config.processor, m, tableHelper)
	if err != nil {
		return nil, err
	}
	m.streamingWorker.start()

	return m, nil
}

//CreateMySQLAdapter creates mysql adapter with database
//if database doesn't exist - mysql returns error. In this case connect without database and create it
func CreateMySQLAdapter(ctx context.Context, config adapters.DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*adapters.MySQL, error) {
	mySQLAdapter, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
	if err != nil {
		if mErr, ok := err.(*mysql.MySQLError); ok {
			//db doesn't exist
			if mErr.Number == 1049 {
				mySQLDB := config.Db
				config.Db = ""
				//create adapter without a certain DB
				tmpMySQLAdapter, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				defer tmpMySQLAdapter.Close()

				config.Db = mySQLDB
				//create DB and reconnect
				if err = tmpMySQLAdapter.CreateDB(config.Db); err != nil {
					return nil, err
				}

				//create adapter with a certain DB
				mySQLAdapterWithDB, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				return mySQLAdapterWithDB, nil
			}
		}
		return nil, err
	}

	return mySQLAdapter, nil
}

func (m *MySQL) DryRun(payload events.Event) ([][]adapters.TableField, error) {
	_, tableHelper := m.getAdapters()
	return dryRun(payload, m.processor, tableHelper)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (m *MySQL) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	_, tableHelper := m.getAdapters()
	flatData, failedEvents, skippedEvents, err := m.processor.ProcessEvents(fileName, objects, alreadyUploadedTables, needCopyEvent)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		m.eventsCache.Error(m.IsCachingDisabled(), m.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		m.eventsCache.Skip(m.IsCachingDisabled(), m.ID(), skipEvent.EventID, skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := m.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				m.eventsCache.Error(m.IsCachingDisabled(), m.ID(), m.uniqueIDField.Extract(object), err.Error())
			} else {
				m.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  m.IsCachingDisabled(),
					DestinationID:  m.ID(),
					EventID:        m.uniqueIDField.Extract(object),
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
func (m *MySQL) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := m.getAdapters()
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(m.ID(), table)
	if err != nil {
		return err
	}

	start := timestamp.Now()
	if err := m.adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}
	logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", m.ID(), len(fdata.GetPayload()), timestamp.Now().Sub(start).Seconds())

	return nil
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (m *MySQL) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(m, overriddenDataSchema, objects, timeIntervalValue, cacheTable, needCopyEvent)
}

func (m *MySQL) Clean(tableName string) error {
	return cleanImpl(m, tableName)
}

//Update updates record in Mysql
func (m *MySQL) Update(eventContext *adapters.EventContext) error {
	_, tableHelper := m.getAdapters()
	processedObject := eventContext.ProcessedEvent
	table := eventContext.Table

	dbSchema, err := tableHelper.EnsureTableWithCaching(m.ID(), table)
	if err != nil {
		return err
	}

	start := timestamp.Now()
	if err = m.adapter.Update(dbSchema, processedObject, m.uniqueIDField.GetFlatFieldName(), m.uniqueIDField.Extract(processedObject)); err != nil {
		return err
	}

	logging.Debugf("[%s] Updated 1 row in [%.2f] seconds", m.ID(), timestamp.Now().Sub(start).Seconds())
	return nil
}

//GetUsersRecognition returns users recognition configuration
func (m *MySQL) GetUsersRecognition() *UserRecognitionConfiguration {
	return m.usersRecognitionConfiguration
}

//Type returns MySQL type
func (m *MySQL) Type() string {
	return MySQLType
}

//Close closes MySQL adapter, fallback logger and streaming worker
func (m *MySQL) Close() (multiErr error) {
	if err := m.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", m.ID(), err))
	}

	if m.streamingWorker != nil {
		if err := m.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", m.ID(), err))
		}
	}

	if err := m.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
