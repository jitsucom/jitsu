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
	RegisterStorage(MySQLType, NewMySQL)
}

//NewMySQL returns configured MySQL Destination
func NewMySQL(config *Config) (Storage, error) {
	mConfig := config.destination.DataSource
	if err := mConfig.Validate(); err != nil {
		return nil, err
	}
	//enrich with default parameters
	if mConfig.Port.String() == "" {
		mConfig.Port = "3306"
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %s", config.destinationID, mConfig.Port.String())
	}
	//schema and database are synonyms in MySQL
	mConfig.Schema = mConfig.Db
	//default connect timeout seconds
	//if _, ok := mConfig.Parameters["connect_timeout"]; !ok {
	//	mConfig.Parameters["connect_timeout"] = "600"
	//}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	adapter, err := adapters.NewMySQL(config.ctx, mConfig, queryLogger, config.sqlTypes)
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(adapter, config.monitorKeeper, config.pkFields, adapters.SchemaToMySQL, config.maxColumns)

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
	m.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, m, tableHelper)
	m.streamingWorker.start()

	return m, nil
}

func (m *MySQL) DryRun(payload events.Event) ([]adapters.TableField, error) {
	_, tableHelper := m.getAdapters()
	return dryRun(payload, m.processor, tableHelper)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (m *MySQL) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	_, tableHelper := m.getAdapters()
	flatData, failedEvents, err := m.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		m.eventsCache.Error(m.IsCachingDisabled(), m.ID(), failedEvent.EventID, failedEvent.Error)
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
				m.eventsCache.Succeed(m.IsCachingDisabled(), m.ID(), m.uniqueIDField.Extract(object), object, table)
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
func (m *MySQL) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := m.getAdapters()
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(m.ID(), table)
	if err != nil {
		return err
	}

	start := time.Now()
	if err := m.adapter.BulkInsert(dbSchema, fdata.GetPayload()); err != nil {
		return err
	}
	logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", m.ID(), len(fdata.GetPayload()), time.Now().Sub(start).Seconds())

	return nil
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (m *MySQL) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return syncStoreImpl(m, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

//Update uses SyncStore under the hood
func (m *MySQL) Update(object map[string]interface{}) error {
	return m.SyncStore(nil, []map[string]interface{}{object}, "", true)
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
